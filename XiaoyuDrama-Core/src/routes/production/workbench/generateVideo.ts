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

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    uploadData: z.array(z.object({
      id: z.number().int().positive(),
      sources: z.enum(["assets", "storyboard"]),
      fileType: z.enum(["image", "video", "audio"]).optional(),
    })).max(32),
    prompt: z.string().max(20000),
    model: z.string().trim().min(3),
    mode: modeSchema,
    resolution: z.string().trim().min(1).max(64),
    duration: z.number().positive(),
    audio: z.boolean().optional(),
    trackId: z.number().int().positive(),
  }),
  async (req, res, next) => {
    try {
      const prepared = await prepareVideoGeneration(req.body);
      const [created] = await createVideoGenerationRecords([prepared]);
      res.status(200).send(success(created.videoId));
      launchVideoGeneration(created);
    } catch (exception) {
      next(exception);
    }
  },
);
