import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertProjectScript, createUniqueVideoTrackId } from "../trackUtils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    prompt: z.string(),
    duration: z.number().nonnegative(),
    state: z.string(),
    videoDesc: z.string(),
    shouldGenerateImage: z.number().int().min(0).max(1),
    src: z.string().nullable(),
    scriptId: z.number().int().positive(),
    projectId: z.number().int().positive(),
  }),
  async (req, res, next) => {
    try {
      const { prompt, duration, state, src, scriptId, projectId, videoDesc, shouldGenerateImage } = req.body;
      const id = await u.db.transaction(async (trx: any) => {
        await assertProjectScript(trx, projectId, scriptId);
        const trackId = await createUniqueVideoTrackId(trx);
        await trx("o_videoTrack").insert({ id: trackId, scriptId, projectId, duration });
        const [storyboardId] = await trx("o_storyboard").insert({
          prompt,
          duration,
          state,
          filePath: src ? u.replaceUrl(src) : null,
          trackId,
          videoDesc,
          shouldGenerateImage,
          scriptId,
          projectId,
          createTime: Date.now(),
        });
        return storyboardId;
      });
      res.status(200).send(success({ id }));
    } catch (exception) {
      next(exception);
    }
  },
);
