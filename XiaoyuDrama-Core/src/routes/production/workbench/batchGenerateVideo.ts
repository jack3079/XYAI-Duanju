import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  createVideoGenerationRecords,
  launchVideoGeneration,
  prepareVideoGeneration,
} from "@/utils/workbenchVideoGeneration";

const router = express.Router();
const modeSchema = z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]);
const uploadSchema = z.array(z.object({
  id: z.number().int().positive(),
  sources: z.enum(["assets", "storyboard"]),
  fileType: z.enum(["image", "video", "audio"]).optional(),
})).max(32);

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    trackData: z.array(z.object({
      uploadData: uploadSchema,
      trackId: z.number().int().positive(),
      prompt: z.string().max(20000),
      duration: z.number().positive(),
    })).min(1).max(50),
    model: z.string().trim().min(3),
    mode: modeSchema,
    resolution: z.string().trim().min(1).max(64),
    audio: z.boolean().optional(),
  }),
  async (req, res, next) => {
    try {
      const { projectId, scriptId, trackData, model, mode, resolution, audio } = req.body;
      const trackIds = trackData.map((item: any) => Number(item.trackId));
      if (new Set(trackIds).size !== trackIds.length) {
        const error = new Error("批量生成包含重复的视频轨道") as Error & { status?: number };
        error.status = 400;
        throw error;
      }

      const prepared = await Promise.all(trackData.map((track: any) => prepareVideoGeneration({
        projectId,
        scriptId,
        trackId: track.trackId,
        prompt: track.prompt,
        duration: track.duration,
        uploadData: track.uploadData,
        model,
        mode,
        resolution,
        audio,
      })));
      const created = await createVideoGenerationRecords(prepared);

      res.status(200).send(success(created.map((item) => ({
        videoId: item.videoId,
        trackId: item.trackId,
      }))));
      for (const item of created) launchVideoGeneration(item);
    } catch (exception) {
      next(exception);
    }
  },
);
