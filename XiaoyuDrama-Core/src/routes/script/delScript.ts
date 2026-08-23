import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { scriptsActiveWorkMessage } from "@/utils/activeWorkGuard";

const router = express.Router();
const ACTIVE_RUN_STATUSES = ["queued", "running", "pause_requested", "cancel_requested"];

async function cleanupFile(filePath: unknown): Promise<void> {
  const value = String(filePath || "").trim();
  if (!value) return;
  try {
    if (await u.oss.fileExists(value)) await u.oss.deleteFile(value);
  } catch (exception) {
    console.warn(`[删除剧集] 清理文件失败 ${value}:`, u.error(exception).message);
  }
}

export default router.post(
  "/",
  validateFields({ ids: z.array(z.number().int().positive()).min(1).max(200) }),
  async (req, res) => {
    const ids = [...new Set<number>(req.body.ids)];
    if (ids.length !== req.body.ids.length) return res.status(400).send(error("删除列表包含重复剧集 id"));

    try {
      const scripts = await u.db("o_script").whereIn("id", ids).select("id", "projectId");
      if (!scripts.length) return res.status(404).send(error("未找到需要删除的剧集"));
      const scriptIds = scripts.map((row: any) => Number(row.id));
      const projectIds = [...new Set(scripts.map((row: any) => Number(row.projectId || 0)).filter((id: number) => id > 0))];

      const manualWork = await scriptsActiveWorkMessage(scriptIds);
      if (manualWork) {
        return res.status(409).send(error(`所选剧集仍有后台生成任务正在执行：${manualWork}。请等待任务结束后再删除`));
      }

      if (projectIds.length) {
        const activeRun = await u.db("o_xiaoyuPipelineRun")
          .whereIn("projectId", projectIds)
          .whereIn("status", ACTIVE_RUN_STATUSES)
          .first("id", "projectId", "status");
        if (activeRun) {
          return res.status(409).send(error(`项目 ${activeRun.projectId} 仍有一键生产任务 ${activeRun.id}（${activeRun.status}），请先取消任务再删除剧集`));
        }
      }

      const files = new Set<string>();
      await u.db.transaction(async (trx: any) => {
        const storyboards = await trx("o_storyboard").whereIn("scriptId", scriptIds).select("id", "filePath");
        const storyboardIds = storyboards.map((row: any) => Number(row.id)).filter((id: number) => id > 0);
        for (const row of storyboards) if (row.filePath) files.add(String(row.filePath));

        const videos = await trx("o_video").whereIn("scriptId", scriptIds).select("id", "filePath");
        for (const row of videos) if (row.filePath) files.add(String(row.filePath));

        const assets = await trx("o_assets").whereIn("scriptId", scriptIds).select("id", "imageId");
        const assetIds = assets.map((row: any) => Number(row.id)).filter((id: number) => id > 0);
        const imageIds = assets.map((row: any) => Number(row.imageId || 0)).filter((id: number) => id > 0);
        if (assetIds.length) {
          const images = await trx("o_image").whereIn("assetsId", assetIds).select("id", "filePath");
          for (const row of images) {
            if (row.id != null) imageIds.push(Number(row.id));
            if (row.filePath) files.add(String(row.filePath));
          }
        }

        const masters = await trx("o_xiaoyuEpisodeMaster").whereIn("scriptId", scriptIds).select("filePath", "reportPath");
        for (const row of masters) {
          if (row.filePath) files.add(String(row.filePath));
          if (row.reportPath) files.add(String(row.reportPath));
        }

        if (storyboardIds.length) await trx("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
        if (assetIds.length) {
          await trx("o_assets2Storyboard").whereIn("assetId", assetIds).delete();
          await trx("o_scriptAssets").whereIn("assetId", assetIds).delete();
          await trx("o_assetsRole2Audio").whereIn("assetsRoleId", assetIds).orWhereIn("assetsAudioId", assetIds).delete();
          await trx("o_assets").whereIn("id", assetIds).update({ imageId: null });
        }
        await trx("o_scriptAssets").whereIn("scriptId", scriptIds).delete();

        const uniqueImageIds = [...new Set(imageIds)];
        if (assetIds.length) await trx("o_image").whereIn("assetsId", assetIds).delete();
        if (uniqueImageIds.length) await trx("o_image").whereIn("id", uniqueImageIds).delete();

        await trx("o_video").whereIn("scriptId", scriptIds).delete();
        await trx("o_videoTrack").whereIn("scriptId", scriptIds).delete();
        await trx("o_storyboard").whereIn("scriptId", scriptIds).delete();
        await trx("o_assets").whereIn("scriptId", scriptIds).delete();
        await trx("o_xiaoyuEpisodeMaster").whereIn("scriptId", scriptIds).delete();

        if (projectIds.length) {
          await trx("o_agentWorkData").whereIn("projectId", projectIds).whereIn("episodesId", scriptIds).delete();
        }
        const affected = await trx("o_script").whereIn("id", scriptIds).delete();
        if (affected !== scriptIds.length) throw new Error("部分剧集已变化，请刷新后重试");
      });

      for (const filePath of files) await cleanupFile(filePath);
      res.status(200).send(success({ message: "删除剧集成功", deleted: scriptIds.length }));
    } catch (exception) {
      console.error("[删除剧集]", exception);
      const status = Number((exception as any)?.status || 500);
      res.status(status >= 400 && status <= 599 ? status : 500).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
