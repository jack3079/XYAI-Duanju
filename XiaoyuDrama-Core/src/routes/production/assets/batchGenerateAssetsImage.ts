import express from "express";
import pLimit from "p-limit";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getModelRouteAvailability } from "@/xiaoyu/modelRouting";

const router = express.Router();

function httpError(status: number, message: string): Error {
  const exception = new Error(message) as Error & { status?: number };
  exception.status = status;
  return exception;
}

export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number().int().positive()).min(1).max(100),
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    concurrentCount: z.number().int().min(1).max(10).optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, scriptId, concurrentCount = 3 } = req.body;
      const assetIds = [...new Set<number>(req.body.assetIds)];
      if (assetIds.length !== req.body.assetIds.length) return res.status(400).send(error("资产列表包含重复 id"));

      const [project, script] = await Promise.all([
        u.db("o_project").where({ id: projectId }).select("id", "imageModel", "imageQuality", "artStyle").first(),
        u.db("o_script").where({ id: scriptId, projectId }).first("id"),
      ]);
      if (!project) return res.status(404).send(error("项目不存在"));
      if (!script) return res.status(404).send(error("剧集不存在或不属于当前项目"));

      const imageModel = String(project.imageModel || "").trim();
      const route = await getModelRouteAvailability(imageModel, "image");
      if (!route.ok) return res.status(400).send(error(`图片模型不可用：${route.reason}`));
      const imageQuality = ["1K", "2K", "4K"].includes(String(project.imageQuality)) ? String(project.imageQuality) : "2K";

      const assets = await u.db("o_assets").where({ projectId }).whereIn("id", assetIds).select("id", "describe", "name", "type", "assetsId", "scriptId");
      if (assets.length !== assetIds.length) return res.status(400).send(error("部分资产不存在或不属于当前项目"));
      const wrongScript = assets.find((item: any) => item.scriptId != null && Number(item.scriptId) !== scriptId);
      if (wrongScript) return res.status(400).send(error(`资产 ${wrongScript.id} 不属于当前剧集`));

      const parentIds = [...new Set(assets.map((item: any) => Number(item.assetsId || 0)).filter((id: number) => id > 0))];
      const parents = parentIds.length
        ? await u.db("o_assets")
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .where("o_assets.projectId", projectId)
            .whereIn("o_assets.id", parentIds)
            .select("o_assets.id", "o_image.filePath", "o_assets.describe")
        : [];
      const parentById = new Map(parents.map((item: any) => [Number(item.id), item]));

      const promptRecord: Record<string, string> = {
        role: String(u.getArtPrompt(project.artStyle || "无", "art_skills", "art_character_derivative") || ""),
        tool: String(u.getArtPrompt(project.artStyle || "无", "art_skills", "art_prop_derivative") || ""),
        scene: String(u.getArtPrompt(project.artStyle || "无", "art_skills", "art_scene_derivative") || ""),
      };

      const imageIdMap = new Map<number, number>();
      await u.db.transaction(async (trx: any) => {
        for (const asset of assets) {
          const [imageId] = await trx("o_image").insert({
            assetsId: asset.id,
            type: asset.type,
            state: "生成中",
            resolution: imageQuality,
            model: imageModel,
            errorReason: null,
          });
          const affected = await trx("o_assets").where({ id: asset.id, projectId }).update({ imageId });
          if (affected !== 1) throw httpError(409, `资产 ${asset.id} 已变化，请刷新后重试`);
          imageIdMap.set(Number(asset.id), Number(imageId));
        }
      });

      res.status(200).send(success("开始生成资产图片"));

      const limit = pLimit(concurrentCount);
      const tasks = assets.map((asset: any) => limit(async () => {
        const imageId = imageIdMap.get(Number(asset.id));
        if (!imageId) return;
        try {
          const parent = parentById.get(Number(asset.assetsId || 0));
          const system = promptRecord[String(asset.type || "role")] || promptRecord.role;
          if (!system.trim()) throw new Error(`缺少 ${asset.type || "role"} 资产绘图提示词模板`);

          const { text } = await u.Ai.Text("universalAi").invoke({
            system,
            messages: [{
              role: "user",
              content: `父级资产描述: ${parent?.describe || "无详细描述"}\n当前资产描述: ${asset.describe || "无详细描述"}`,
            }],
          });
          const prompt = String(text || "").trim();
          if (!prompt) throw new Error("文本 Agent 未返回资产图片提示词");
          await u.db("o_assets").where({ id: asset.id, projectId }).update({ prompt });

          let referenceList: { type: "image"; base64: string }[] = [];
          if (parent?.filePath && await u.oss.fileExists(parent.filePath)) {
            referenceList = [{ type: "image", base64: await u.oss.getImageBase64(parent.filePath) }];
          }
          const image = await u.Ai.Image(imageModel as `${string}:${string}`).run(
            { prompt, referenceList, size: imageQuality as "1K" | "2K" | "4K", aspectRatio: "16:9" },
            {
              taskClass: "生成图片",
              describe: "资产图片生成",
              relatedObjects: JSON.stringify({ assetId: asset.id, imageId }),
              projectId,
            },
          );
          const savePath = `${projectId}/assets/${scriptId}/${asset.type || "asset"}/${u.uuid()}.jpg`;
          await image.save(savePath);
          const affected = await u.db("o_image").where({ id: imageId }).update({ state: "已完成", filePath: savePath, errorReason: null });
          if (affected !== 1) throw new Error(`图片记录已变化：${imageId}`);
        } catch (exception) {
          const message = u.error(exception).message;
          console.error(`[资产图片] asset=${asset.id} 生成失败:`, message);
          await u.db("o_image").where({ id: imageId }).update({ state: "生成失败", errorReason: message }).catch(() => undefined);
        }
      }));
      void Promise.all(tasks).catch((exception) => console.error("[资产图片] 批量后台任务异常", u.error(exception).message));
    } catch (exception) {
      const status = Number((exception as any)?.status || 400);
      res.status(status >= 400 && status <= 599 ? status : 400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
