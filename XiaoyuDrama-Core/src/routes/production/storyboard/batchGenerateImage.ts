import express from "express";
import pLimit from "p-limit";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getModelRouteAvailability } from "@/xiaoyu/modelRouting";

const router = express.Router();

async function getAssetsImageBase64(projectId: number, imageIds: number[]) {
  if (!imageIds.length) return [];
  const rows = await u.db("o_image")
    .join("o_assets", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereIn("o_image.id", imageIds)
    .select("o_image.id", "o_image.filePath");
  const pathById = new Map<number, string>();
  for (const row of rows) {
    if (row.id != null && row.filePath) pathById.set(Number(row.id), String(row.filePath));
  }
  const result: { type: "image"; base64: string }[] = [];
  for (const id of imageIds) {
    const filePath = pathById.get(id);
    if (!filePath || !(await u.oss.fileExists(filePath))) continue;
    result.push({ type: "image", base64: await u.oss.getImageBase64(filePath) });
  }
  return result;
}

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number().int().positive()).min(1).max(200),
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    concurrentCount: z.number().int().min(1).max(10).optional(),
    compulsory: z.boolean().optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, scriptId, concurrentCount = 3, compulsory = false } = req.body;
      const storyboardIds = [...new Set<number>(req.body.storyboardIds)];
      if (storyboardIds.length !== req.body.storyboardIds.length) return res.status(400).send(error("分镜列表包含重复 id"));

      const [project, script] = await Promise.all([
        u.db("o_project").where({ id: projectId }).select("id", "imageModel", "imageQuality", "videoRatio").first(),
        u.db("o_script").where({ id: scriptId, projectId }).first("id"),
      ]);
      if (!project) return res.status(404).send(error("项目不存在"));
      if (!script) return res.status(404).send(error("剧集不存在或不属于当前项目"));

      const imageModel = String(project.imageModel || "").trim();
      const modelRoute = await getModelRouteAvailability(imageModel, "image");
      if (!modelRoute.ok) return res.status(400).send(error(`图片模型不可用：${modelRoute.reason}`));
      const imageQuality = ["1K", "2K", "4K"].includes(String(project.imageQuality)) ? String(project.imageQuality) : "2K";
      const aspectRatio = project.videoRatio === "9:16" ? "9:16" : "16:9";

      const storyboards = await u.db("o_storyboard").where({ scriptId, projectId }).whereIn("id", storyboardIds);
      if (storyboards.length !== storyboardIds.length) return res.status(400).send(error("部分分镜不存在或不属于当前剧集"));
      const storyIds = storyboards.map((item: any) => Number(item.id));

      const links = await u.db("o_assets2Storyboard")
        .whereIn("storyboardId", storyIds)
        .orderBy("rowid")
        .select("storyboardId", "assetId");
      const assetIds = [...new Set(links.map((row: any) => Number(row.assetId || 0)).filter((id: number) => id > 0))];
      const assetRows = assetIds.length
        ? await u.db("o_assets").where({ projectId }).whereIn("id", assetIds).select("id", "imageId")
        : [];
      const assetImageMap = new Map<number, number>();
      for (const row of assetRows) {
        if (row.id != null && row.imageId != null) assetImageMap.set(Number(row.id), Number(row.imageId));
      }
      const imageIdsByStoryboard = new Map<number, number[]>();
      for (const link of links) {
        const storyboardId = Number(link.storyboardId || 0);
        const imageId = assetImageMap.get(Number(link.assetId || 0));
        if (!storyboardId || !imageId) continue;
        if (!imageIdsByStoryboard.has(storyboardId)) imageIdsByStoryboard.set(storyboardId, []);
        imageIdsByStoryboard.get(storyboardId)!.push(imageId);
      }

      const generateList = compulsory ? storyboards : storyboards.filter((item: any) => Number(item.shouldGenerateImage || 0) !== 0);
      await u.db.transaction(async (trx: any) => {
        if (!compulsory) {
          await trx("o_storyboard").where({ scriptId, projectId }).whereIn("id", storyIds).where("shouldGenerateImage", 0).update({ state: "未生成", reason: null });
        }
        if (generateList.length) {
          const ids = generateList.map((item: any) => Number(item.id));
          await trx("o_storyboard").where({ scriptId, projectId }).whereIn("id", ids).update({
            state: "生成中",
            reason: null,
            ...(compulsory ? { shouldGenerateImage: 1 } : {}),
          });
        }
      });

      const refreshed = await u.db("o_storyboard").where({ scriptId, projectId }).whereIn("id", storyIds);
      res.status(200).send(success(refreshed.map((item: any) => ({
        id: item.id,
        prompt: item.prompt,
        associateAssetsIds: imageIdsByStoryboard.get(Number(item.id)) || [],
        src: null,
        state: item.state,
        videoDesc: item.videoDesc,
        shouldGenerateImage: item.shouldGenerateImage,
      }))));

      const limit = pLimit(concurrentCount);
      const tasks = generateList.map((item: any) => limit(async () => {
        const id = Number(item.id);
        try {
          const prompt = String(item.prompt || "").trim();
          if (!prompt) throw new Error("分镜图片提示词为空");
          const image = await u.Ai.Image(imageModel as `${string}:${string}`).run(
            {
              referenceList: await getAssetsImageBase64(projectId, imageIdsByStoryboard.get(id) || []),
              prompt,
              size: imageQuality as "1K" | "2K" | "4K",
              aspectRatio,
            },
            {
              taskClass: "生成分镜图片",
              describe: "分镜图片生成",
              relatedObjects: JSON.stringify({ storyboardId: id, scriptId }),
              projectId,
            },
          );
          const savePath = `${projectId}/assets/${scriptId}/storyboard/${u.uuid()}.jpg`;
          await image.save(savePath);
          const affected = await u.db("o_storyboard").where({ id, scriptId, projectId }).update({
            filePath: savePath,
            state: "已完成",
            reason: null,
          });
          if (affected !== 1) throw new Error(`分镜记录已变化：${id}`);
        } catch (exception) {
          const message = u.error(exception).message;
          console.error(`[分镜图片] storyboard=${id} 生成失败:`, message);
          await u.db("o_storyboard").where({ id, scriptId, projectId }).update({
            filePath: null,
            reason: message,
            state: "生成失败",
          }).catch(() => undefined);
        }
      }));
      void Promise.all(tasks).catch((exception) => console.error("[分镜图片] 批量后台任务异常", u.error(exception).message));
    } catch (exception) {
      const status = Number((exception as any)?.status || 400);
      res.status(status >= 400 && status <= 599 ? status : 400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
