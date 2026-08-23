import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { prepareVideoPromptContext, type VideoPromptTaskInput } from "@/utils/workbenchVideoPrompt";
import { claimVideoPromptTracks, launchClaimedVideoPromptBatch } from "@/utils/workbenchVideoPromptClaim";

const router = express.Router();
const modeSchema = z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]);
const infoSchema = z.array(z.object({
  id: z.number().int().positive(),
  sources: z.enum(["assets", "storyboard"]),
  fileType: z.enum(["image", "video", "audio"]).optional(),
})).max(64);

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    trackData: z.array(z.object({
      trackId: z.number().int().positive(),
      info: infoSchema,
    })).min(1).max(100),
    mode: modeSchema,
    model: z.string().trim().min(3),
    concurrentCount: z.number().int().min(1).max(10).optional(),
  }),
  async (req, res) => {
    try {
      const { projectId, trackData, mode, model, concurrentCount = 3 } = req.body;
      const trackIds = trackData.map((item: any) => Number(item.trackId));
      if (new Set(trackIds).size !== trackIds.length) return res.status(400).send(error("批量提示词生成包含重复轨道"));

      const context = await prepareVideoPromptContext(projectId, model, mode);
      const inputs: VideoPromptTaskInput[] = trackData.map((track: any) => ({
        projectId,
        trackId: track.trackId,
        info: track.info,
        model,
        mode,
      }));
      // 原子占用：一条轨道已在生成则整批回滚，不产生重复模型调用。
      await claimVideoPromptTracks(inputs);

      launchClaimedVideoPromptBatch(inputs, context, concurrentCount);
      res.status(200).send(success("开始生成提示词"));
    } catch (exception) {
      const status = Number((exception as any)?.status || 400);
      const safeStatus = status >= 400 && status <= 599 ? status : 400;
      res.status(safeStatus).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
