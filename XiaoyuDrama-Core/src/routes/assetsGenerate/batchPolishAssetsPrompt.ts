import express from "express";
import u from "@/utils";
import pLimit from "p-limit";
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
    items: z.array(z.object({
      assetsId: z.number().int().positive(),
      type: z.enum(["role", "scene", "tool"]),
      name: z.string().trim().min(1).max(200),
      describe: z.string(),
    })).min(1).max(500),
    projectId: z.number().int().positive(),
    concurrentCount: z.number().int().min(1).max(16).optional(),
    otherTextPrompt: z.string().optional(),
  }),
  async (req, res) => {
    const { projectId, items } = req.body;
    const concurrentCount = Number(req.body.concurrentCount || 1);
    const otherTextPrompt = String(req.body.otherTextPrompt || "");

    const project = await u.db("o_project").where({ id: projectId }).select("id", "artStyle").first();
    if (!project) return res.status(404).send(error("项目不存在"));

    const assetIds = items.map((item: any) => Number(item.assetsId));
    if (new Set(assetIds).size !== assetIds.length) return res.status(400).send(error("批量任务包含重复素材"));
    const assetRows = await u.db("o_assets").where({ projectId }).whereIn("id", assetIds).select("id", "assetsId");
    const assetMap = new Map(assetRows.map((row: any) => [Number(row.id), row]));
    const missingIds = assetIds.filter((id: number) => !assetMap.has(id));
    if (missingIds.length) return res.status(404).send(error(`以下素材不存在或不属于当前项目：${missingIds.join("、")}`));

    await u.db("o_assets").where({ projectId }).whereIn("id", assetIds).update({ promptState: "生成中", promptErrorReason: null });

    const limit = pLimit(concurrentCount);
    const tasks = items.map((item: any) => limit(async () => {
      const assetId = Number(item.assetsId);
      try {
        const asset = assetMap.get(assetId);
        const config = configFor(item.type as AssetType, Boolean(asset?.assetsId));
        const visualManual = String(await u.getArtPrompt(String(project.artStyle || ""), "art_skills", config.visualManual) || "");
        if (!visualManual.trim()) throw new Error("视觉手册未定义，请先配置项目画风");

        const result = await u.Ai.Text("universalAi").invoke({
          system: `${visualManual}${otherTextPrompt ? `\n${otherTextPrompt}` : ""}`,
          messages: [{
            role: "user",
            content: `**基础参数：**\n**${config.nameLabel}设定：**\n- ${config.nameLabel}名称: ${item.name}\n- ${config.nameLabel}描述: ${item.describe}`,
          }],
        });
        const text = String((result as any)?.text || "").trim();
        if (!text) throw new Error("文本模型未返回润色结果");

        await u.db("o_assets").where({ id: assetId, projectId }).update({
          prompt: text,
          promptState: "已完成",
          promptErrorReason: null,
        });
      } catch (exception) {
        const message = u.error(exception).message || "生成失败";
        await u.db("o_assets").where({ id: assetId, projectId }).update({
          promptState: "生成失败",
          promptErrorReason: message,
        }).catch((dbError: unknown) => console.error(`[assets] 更新素材 ${assetId} 失败状态异常`, dbError));
      }
    }));

    void Promise.allSettled(tasks).then((results) => {
      const rejected = results.filter((item) => item.status === "rejected");
      if (rejected.length) console.error(`[assets] 批量提示词任务存在 ${rejected.length} 个未捕获异常`);
    });

    return res.status(200).send(success({ total: items.length, state: "生成中" }));
  },
);
