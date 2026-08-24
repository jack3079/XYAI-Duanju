import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getModelRouteAvailability } from "@/xiaoyu/modelRouting";

const router = express.Router();
type AssetType = "role" | "scene" | "tool";

const assetTypeConfig: Record<AssetType, { label: string; taskClass: string; dir: string; promptTitle: string; promptEnd: string }> = {
  role: { label: "角色", taskClass: "角色图生成", dir: "role", promptTitle: "角色标准四视图", promptEnd: "人物角色四视图" },
  scene: { label: "场景", taskClass: "场景图生成", dir: "scene", promptTitle: "标准场景图", promptEnd: "标准场景图" },
  tool: { label: "道具", taskClass: "道具图生成", dir: "props", promptTitle: "标准道具图", promptEnd: "标准道具图" },
};

function normalizeAssetType(value: string): AssetType {
  if (value === "props") return "tool";
  if (value === "role" || value === "scene" || value === "tool") return value;
  throw new Error(`不支持的素材类型：${value}`);
}

function buildPrompt(cfg: (typeof assetTypeConfig)[AssetType], artStyle: string, name: string, prompt: string): string {
  return `请根据以下参数生成${cfg.promptTitle}：\n\n**基础参数：**\n- 画风风格: ${artStyle || "未指定"}\n\n**${cfg.label}设定：**\n- 名称: ${name}\n- 提示词: ${prompt}\n\n请严格按照系统规范生成${cfg.promptEnd}。`;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    model: z.string().trim().min(3),
    resolution: z.enum(["1K", "2K", "4K"]),
    id: z.number().int().positive(),
    type: z.enum(["role", "scene", "tool", "props"]),
    name: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1),
    base64: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, model, resolution, id, name, prompt, base64 } = req.body;
    const type = normalizeAssetType(req.body.type);
    const cfg = assetTypeConfig[type];

    const project = await u.db("o_project").where({ id: projectId }).select("id", "artStyle").first();
    if (!project) return res.status(404).send(error("项目不存在"));
    const asset = await u.db("o_assets").where({ id, projectId }).select("id").first();
    if (!asset) return res.status(404).send(error("素材不存在或不属于当前项目"));

    const route = await getModelRouteAvailability(model, "image");
    if (!route.ok) return res.status(400).send(error(`图片模型不可用：${route.reason}`));

    let imageId = 0;
    await u.db.transaction(async (trx: any) => {
      const ids = await trx("o_image").insert({
        type,
        state: "生成中",
        assetsId: id,
        model: route.modelId,
        resolution,
      });
      imageId = Number(ids[0]);
      const affected = await trx("o_assets").where({ id, projectId }).update({ imageId });
      if (affected !== 1) throw new Error("素材在生成开始前已被删除或修改");
    });

    const imagePath = `/${projectId}/${cfg.dir}/${uuidv4()}.jpg`;
    let saved = false;
    try {
      const aiImage = u.Ai.Image(model as `${string}:${string}`);
      await aiImage.run(
        {
          prompt: buildPrompt(cfg, String(project.artStyle || ""), name, prompt),
          referenceList: base64 ? [{ type: "image", base64 }] : [],
          size: resolution,
          aspectRatio: "16:9",
        },
        {
          taskClass: cfg.taskClass,
          describe: `生成${cfg.label}图，名称：${name}，提示词：${prompt}`,
          projectId,
          relatedObjects: JSON.stringify({ id, projectId, type: cfg.label }),
        },
      );
      await aiImage.save(imagePath);
      saved = true;

      const applied = await u.db.transaction(async (trx: any) => {
        const image = await trx("o_image").where({ id: imageId, assetsId: id }).first("id", "state");
        const currentAsset = await trx("o_assets").where({ id, projectId }).first("id");
        if (!image || !currentAsset || String(image.state || "") !== "生成中") return false;
        await trx("o_image").where({ id: imageId }).update({
          state: "已完成",
          errorReason: null,
          filePath: imagePath,
          type,
          model: route.modelId,
          resolution,
        });
        await trx("o_assets").where({ id, projectId }).update({ imageId });
        return true;
      });

      if (!applied) {
        await u.oss.deleteFile(imagePath).catch(() => undefined);
        return res.status(409).send(error("素材在图片生成期间已被删除、取消或修改"));
      }
      const preview = await u.oss.getSmallImageUrl(imagePath);
      return res.status(200).send(success({ path: preview, assetsId: id, imageId }));
    } catch (exception) {
      const message = u.error(exception).message || "图片生成失败";
      await u.db("o_image").where({ id: imageId }).update({ state: "生成失败", errorReason: message }).catch(() => undefined);
      if (saved) await u.oss.deleteFile(imagePath).catch(() => undefined);
      return res.status(502).send(error(message));
    }
  },
);
