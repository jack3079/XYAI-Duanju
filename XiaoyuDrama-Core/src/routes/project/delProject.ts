import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { projectActiveWorkMessage } from "@/utils/activeWorkGuard";

const router = express.Router();
const ACTIVE_RUN_STATUSES = ["queued", "running", "pause_requested", "cancel_requested"];
const TERMINAL_REMOTE_STATUSES = ["completed", "failed", "cancelled"];

async function cleanupFile(filePath: unknown): Promise<void> {
  const value = String(filePath || "").trim();
  if (!value) return;
  try {
    if (await u.oss.fileExists(value)) await u.oss.deleteFile(value);
  } catch (exception) {
    console.warn(`[删除项目] 清理文件失败 ${value}:`, u.error(exception).message);
  }
}

export default router.post(
  "/",
  validateFields({ id: z.number().int().positive() }),
  async (req, res) => {
    const { id } = req.body;
    try {
      const project = await u.db("o_project").where({ id }).first("id", "name");
      if (!project) return res.status(404).send(error("项目不存在或已删除"));

      const manualWork = await projectActiveWorkMessage(id);
      if (manualWork) {
        return res.status(409).send(error(`项目仍有后台生成任务正在执行：${manualWork}。请等待任务结束后再删除项目`));
      }

      const activeRun = await u.db("o_xiaoyuPipelineRun")
        .where({ projectId: id })
        .whereIn("status", ACTIVE_RUN_STATUSES)
        .first("id", "status");
      if (activeRun) {
        return res.status(409).send(error(`项目仍有一键生产任务 ${activeRun.id}（${activeRun.status}），请先取消任务再删除项目`));
      }
      const activeRemote = await u.db("o_xiaoyuRemoteJob")
        .where({ projectId: id })
        .whereNotIn("status", TERMINAL_REMOTE_STATUSES)
        .first("remoteJobId", "status");
      if (activeRemote) {
        return res.status(409).send(error(`项目仍有远程生成任务未结算（${activeRemote.remoteJobId || "unknown"} / ${activeRemote.status}），暂不能删除`));
      }

      const filesToDelete = new Set<string>();
      await u.db.transaction(async (trx: any) => {
        const scriptRows = await trx("o_script").where({ projectId: id }).select("id");
        const scriptIds = scriptRows.map((row: any) => Number(row.id)).filter((value: number) => value > 0);
        const novelRows = await trx("o_novel").where({ projectId: id }).select("id");
        const novelIds = novelRows.map((row: any) => Number(row.id)).filter((value: number) => value > 0);
        const storyboardRows = await trx("o_storyboard").where({ projectId: id }).select("id", "filePath");
        const storyboardIds = storyboardRows.map((row: any) => Number(row.id)).filter((value: number) => value > 0);
        for (const row of storyboardRows) if (row.filePath) filesToDelete.add(String(row.filePath));

        const assetRows = await trx("o_assets").where({ projectId: id }).select("id", "imageId");
        const assetIds = assetRows.map((row: any) => Number(row.id)).filter((value: number) => value > 0);
        const imageIds = assetRows.map((row: any) => Number(row.imageId || 0)).filter((value: number) => value > 0);
        if (assetIds.length) {
          const assetImages = await trx("o_image").whereIn("assetsId", assetIds).select("id", "filePath");
          for (const row of assetImages) {
            if (row.id != null) imageIds.push(Number(row.id));
            if (row.filePath) filesToDelete.add(String(row.filePath));
          }
        }

        const videoRows = await trx("o_video").where({ projectId: id }).select("filePath");
        for (const row of videoRows) if (row.filePath) filesToDelete.add(String(row.filePath));
        const episodeRows = await trx("o_xiaoyuEpisodeMaster").where({ projectId: id }).select("filePath", "reportPath");
        for (const row of episodeRows) {
          if (row.filePath) filesToDelete.add(String(row.filePath));
          if (row.reportPath) filesToDelete.add(String(row.reportPath));
        }
        const artifactRows = await trx("o_xiaoyuPipelineArtifact")
          .join("o_xiaoyuPipelineRun", "o_xiaoyuPipelineRun.id", "o_xiaoyuPipelineArtifact.runId")
          .where("o_xiaoyuPipelineRun.projectId", id)
          .select("o_xiaoyuPipelineArtifact.filePath");
        for (const row of artifactRows) if (row.filePath) filesToDelete.add(String(row.filePath));

        if (novelIds.length) {
          const chapterRows = await trx("o_eventChapter").whereIn("novelId", novelIds).select("eventId");
          const eventIds = [...new Set(chapterRows.map((row: any) => Number(row.eventId || 0)).filter((value: number) => value > 0))];
          await trx("o_eventChapter").whereIn("novelId", novelIds).delete();
          if (eventIds.length) {
            const stillReferenced = await trx("o_eventChapter").whereIn("eventId", eventIds).distinct("eventId");
            const referenced = new Set(stillReferenced.map((row: any) => Number(row.eventId)));
            const orphaned = eventIds.filter((eventId) => !referenced.has(eventId));
            if (orphaned.length) await trx("o_event").whereIn("id", orphaned).delete();
          }
        }

        if (storyboardIds.length) await trx("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
        if (assetIds.length) {
          await trx("o_assets2Storyboard").whereIn("assetId", assetIds).delete();
          await trx("o_scriptAssets").whereIn("assetId", assetIds).delete();
          await trx("o_assetsRole2Audio").whereIn("assetsRoleId", assetIds).orWhereIn("assetsAudioId", assetIds).delete();
          await trx("o_assets").whereIn("id", assetIds).update({ imageId: null });
        }
        if (scriptIds.length) await trx("o_scriptAssets").whereIn("scriptId", scriptIds).delete();

        const uniqueImageIds = [...new Set(imageIds)];
        if (assetIds.length) await trx("o_image").whereIn("assetsId", assetIds).delete();
        if (uniqueImageIds.length) await trx("o_image").whereIn("id", uniqueImageIds).delete();

        await trx("o_video").where({ projectId: id }).delete();
        await trx("o_videoTrack").where({ projectId: id }).delete();
        await trx("o_storyboard").where({ projectId: id }).delete();
        await trx("o_assets").where({ projectId: id }).delete();
        await trx("o_tasks").where({ projectId: id }).delete();
        await trx("o_agentWorkData").where({ projectId: id }).delete();
        await trx("o_novel").where({ projectId: id }).delete();
        await trx("o_script").where({ projectId: id }).delete();
        await trx("memories").where("isolationKey", "like", `${id}:%`).delete();

        const runRows = await trx("o_xiaoyuPipelineRun").where({ projectId: id }).select("id");
        const runIds = runRows.map((row: any) => String(row.id));
        await trx("o_xiaoyuRemoteJob").where({ projectId: id }).delete();
        await trx("o_xiaoyuEpisodeMaster").where({ projectId: id }).delete();
        if (runIds.length) {
          await trx("o_xiaoyuPipelineArtifact").whereIn("runId", runIds).delete();
          await trx("o_xiaoyuPipelineEvent").whereIn("runId", runIds).delete();
          await trx("o_xiaoyuPipelineNode").whereIn("runId", runIds).delete();
          await trx("o_xiaoyuPipelineRun").whereIn("id", runIds).delete();
        }

        const affected = await trx("o_project").where({ id }).delete();
        if (affected !== 1) throw new Error("项目已变化，请刷新后重试");
      });

      for (const filePath of filesToDelete) await cleanupFile(filePath);
      try {
        await u.oss.deleteDirectory(`${id}/`);
      } catch (exception) {
        console.info(`[删除项目] 项目目录无需清理 ${id}:`, u.error(exception).message);
      }

      res.status(200).send(success({ message: "删除项目成功" }));
    } catch (exception) {
      console.error("[删除项目]", exception);
      const status = Number((exception as any)?.status || 500);
      res.status(status >= 400 && status <= 599 ? status : 500).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
