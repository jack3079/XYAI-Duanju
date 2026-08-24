import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();
type AssetType = "role" | "scene" | "tool";

function configFor(type: AssetType, derivative: boolean) {
  const configs = {
    role: { nameLabel: "角色", visualManual: derivative ? "art_character_derivative" : "art_character" },
    scene: { nameLabel: "场景", visualManual: derivative ? "art_scene_derivative" : "art_scene" },
    tool: { nameLabel: "道具", visualManual: derivative ? "art_prop_derivative" : "art_prop" },
  } as const;
  return configs[type];
}

export default router.post(
  "/",
  validateFields({
    assetsId: z.number().int().positive(),
    projectId: z.number().int().positive(),
    type: z.enum(["role", "scene", "tool"]),
    name: z.string().trim().min(1).max(200),
    describe: z.string(),
  }),
  async (req, res) => {
    const { assetsId, projectId, type, name, describe } = req.body;
    const project = await u.db("o_project").where({ id: projectId }).select("id", "artStyle").first();
    if (!project) return res.status(404).send(error("项目不存在"));

    const asset = await u.db("o_assets").where({ id: assetsId, projectId }).select("id", "assetsId").first();
    if (!asset) return res.status(404).send(error("素材不存在或不属于当前项目"));

    const config = configFor(type, Boolean(asset.assetsId));
    let visualManual = "";
    try {
      visualManual = String(await u.getArtPrompt(String(project.artStyle || ""), "art_skills", config.visualManual) || "");
    } catch (exception) {
      return res.status(400).send(error(`读取视觉手册失败：${u.error(exception).message}`));
    }
    if (!visualManual.trim()) return res.status(400).send(error("视觉手册未定义，请先配置项目画风"));

    await u.db("o_assets").where({ id: assetsId, projectId }).update({ promptState: "生成中", promptErrorReason: null });
    try {
      const result = await u.Ai.Text("universalAi").invoke({
        system: visualManual,
        messages: [{
          role: "user",
          content: `**基础参数：**\n**${config.nameLabel}设定：**\n- ${config.nameLabel}名称: ${name}\n- ${config.nameLabel}描述: ${describe}`,
        }],
      });
      const text = String((result as any)?.text || "").trim();
      if (!text) throw new Error("文本模型未返回润色结果");

      const affected = await u.db("o_assets").where({ id: assetsId, projectId }).update({
        prompt: text,
        promptState: "已完成",
        promptErrorReason: null,
      });
      if (affected !== 1) return res.status(409).send(error("素材在生成期间已被删除或修改"));
      return res.status(200).send(success({ prompt: text, assetsId }));
    } catch (exception) {
      const message = u.error(exception).message || "生成失败";
      await u.db("o_assets").where({ id: assetsId, projectId }).update({ promptState: "生成失败", promptErrorReason: message });
      return res.status(502).send(error(message));
    }
  },
);
