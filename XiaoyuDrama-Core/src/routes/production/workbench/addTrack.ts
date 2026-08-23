import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertProjectScript, createUniqueVideoTrackId } from "@/utils/productionTrack";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    duration: z.number().nonnegative().optional(),
  }),
  async (req, res, next) => {
    try {
      const { projectId, scriptId, duration } = req.body;
      const trackId = await u.db.transaction(async (trx: any) => {
        await assertProjectScript(trx, projectId, scriptId);
        const id = await createUniqueVideoTrackId(trx);
        await trx("o_videoTrack").insert({ id, projectId, scriptId, duration });
        return id;
      });
      res.status(200).send(success(trackId));
    } catch (exception) {
      next(exception);
    }
  },
);
