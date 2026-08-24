import express from "express";
import pLimit from "p-limit";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getModelRouteAvailability } from "@/xiaoyu/modelRouting";

const router = express.Router();
type SupportedType = "role" | "tool" | "scene";

function artPromptFile(type: SupportedType): string {
  if (type === "role") return "art_character_derivative";
  if (type === "scene") return "art_scene_derivative";
  return "art_prop_derivative";
}

export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number().int().positive()).min(1).max(200),
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    concurrentCount: z.number().int().min(1).max(16).optional(),
  }),
  async (req, res, next) => {
    try {
      const projectId = Number(req.body.projectId);
      const scriptId = Number(req.body.scriptId);
      const concurrentCount = Number(req.body.concurrentCount || 5);
      const assetIds = [...new Set((req.body.assetIds as number[]).map(Number))];
      if (assetIds.length !== req.body.assetIds.length) return res.status(400).send(error("批量生成包含重复素材 id"));

      const project = await u.db("o_project").where({ id: projectId }).first("id", "imageModel", "imageQuality", "artStyle");
      if (!project) return res.status(404).send(error("项目不存在"));
      const script = await u.db("o_script").where({ id: scriptId, projectId }).first("id");
      if (!script) return res.status(404).send(error("剧本不存在或不属于当前项目"));

      const imageModel = String(project.imageModel || "").trim();
      const route = await getModelRouteAvailability(imageModel, "image");
      if (!route.ok) return res.status(400).send(error(`项目图片模型不可用：${route.reason}`));
      const imageQuality = ["1K", "2K", "4K"].includes(String(project.imageQuality || ""))
        ? String(project.imageQuality) as "1K" | "2K" | "4K"
        : "2K";
      const artStyle = String(project.artStyle || "").trim();
      if (!artStyle) return res.status(400).send(error("项目尚未配置画风"));

      const assets = await u.db("o_assets")
        .where({ projectId })
        .whereIn("id", assetIds)
        .select("id", "describe", "name", "type", "assetsId");
      const byId = new Map(assets.map((row: any) => [Number(row.id), row]));
      const missing = assetIds.filter((id) => !byId.has(id));
      if (missing.length) return res.status(404).send(error(`以下素材不存在或不属于当前项目：${missing.join("、")}`));

      for (const asset of assets as any[]) {
        const type = String(asset.type || "") as SupportedType;
        if (!["role", "tool", "scene"].includes(type)) {
          return res.status(400).send(error(`素材 ${asset.id} 类型 ${asset.type || "未知"} 不支持衍生图片生成`));
        }
      }

      const parentIds = [...new Set(assets.map((row: any) => Number(row.assetsId || 0)).filter((id) => id > 0))];
      const parents = parentIds.length
        ? await u.db("o_assets")
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .where("o_assets.projectId", projectId)
            .whereIn("o_assets.id", parentIds)
            .select("o_assets.id", "o_assets.describe", "o_image.filePath")
        : [];
      const parentMap = new Map(parents.map((row: any) => [Number(row.id), row]));

      const promptByType = new Map<SupportedType, string>();
      for (const type of ["role", "tool", "scene"] as SupportedType[]) {
        const prompt = String(u.getArtPrompt(artStyle, "art_skills", artPromptFile(type)) || "");
        if (!prompt.trim()) return res.status(400).send(error(`画风 ${artStyle} 缺少 ${artPromptFile(type)} 视觉手册`));
        promptByType.set(type, prompt);
      }

      const jobs: Array<{ asset: any; imageId: number }> = [];
      await u.db.transaction(async (trx: any) => {
        for (const asset of assets as any[]) {
          const [rawImageId] = await trx("o_image").insert({
            assetsId: asset.id,
            type: asset.type,
            state: "生成中",
            errorReason: null,
            resolution: imageQuality,
            model: route.modelId,
          });
          const imageId = Number(rawImageId);
          const affected = await trx("o_assets").where({ id: asset.id, projectId }).update({ imageId });
          if (affected !== 1) throw new Error(`素材 ${asset.id} 在任务创建期间已变化`);
          jobs.push({ asset, imageId });
        }
      });

      const limit = pLimit(concurrentCount);
      const results = await Promise.all(jobs.map(({ asset, imageId }) => limit(async () => {
        const type = String(asset.type) as SupportedType;
        let savePath = "";
        try {
          const parent = parentMap.get(Number(asset.assetsId || 0));
          const { text } = await u.Ai.Text("universalAi").invoke({
            system: promptByType.get(type) || "",
            messages: [{
              role: "user",
              content: `父级资产描述: ${String(parent?.describe || "无详细描述")}\n当前资产名称: ${String(asset.name || "")}\n当前资产描述: ${String(asset.describe || "无详细描述")}`,
            }],
          });
          const prompt = String(text || "").trim();
          if (!prompt) throw new Error("文本模型未返回衍生素材提示词");
          await u.db("o_assets").where({ id: asset.id, projectId }).update({ prompt });

          let parentBase64: string | null = null;
          if (parent?.filePath) {
            try { parentBase64 = await u.oss.getImageBase64(parent.filePath); }
            catch (exception) { console.warn(`[production] 父素材图片读取失败，将无参考图继续生成：${parent.id}`, exception); }
          }

          const image = await u.Ai.Image(imageModel as `${string}:${string}`).run(
            {
              prompt,
              referenceList: parentBase64 ? [{ type: "image", base64: parentBase64 }] : [],
              size: imageQuality,
              aspectRatio: "16:9",
            },
            {
              taskClass: "生成图片",
              describe: `衍生素材图片生成：${String(asset.name || asset.id)}`,
              relatedObjects: JSON.stringify({ assetId: asset.id, scriptId, type }),
              projectId,
            },
          );
          savePath = `${projectId}/assets/${scriptId}/${type}/${u.uuid()}.jpg`;
          await image.save(savePath);

          const applied = await u.db.transaction(async (trx: any) => {
            const imageRow = await trx("o_image").where({ id: imageId, assetsId: asset.id }).first("id", "state");
            const assetRow = await trx("o_assets").where({ id: asset.id, projectId }).first("id");
            if (!imageRow || !assetRow || String(imageRow.state || "") !== "生成中") return false;
            await trx("o_image").where({ id: imageId }).update({ state: "已完成", errorReason: null, filePath: savePath });
            return true;
          });
          if (!applied) {
            await u.oss.deleteFile(savePath).catch(() => undefined);
            return { id: Number(asset.id), state: "生成失败" as const, src: "", errorReason: "素材在生成期间已被删除或取消" };
          }

          let src = "";
          try { src = await u.oss.getSmallImageUrl(savePath); } catch { /* DB/file 已成功，预览失败不回滚 */ }
          return { id: Number(asset.id), state: "已完成" as const, src, errorReason: "" };
        } catch (exception) {
          const message = u.error(exception).message || "衍生素材图片生成失败";
          await u.db("o_image").where({ id: imageId }).update({ state: "生成失败", errorReason: message }).catch(() => undefined);
          if (savePath) await u.oss.deleteFile(savePath).catch(() => undefined);
          return { id: Number(asset.id), state: "生成失败" as const, src: "", errorReason: message };
        }
      }))));

      return res.status(200).send(success(results));
    } catch (exception) {
      next(exception);
    }
  },
);
