import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertProjectScript, createUniqueVideoTrackId } from "@/utils/productionTrack";

const router = express.Router();
const storyboardSchema = z.object({
  prompt: z.string(),
  duration: z.number().nonnegative(),
  track: z.string(),
  state: z.string(),
  src: z.string().nullable(),
  videoDesc: z.string(),
  shouldGenerateImage: z.number().int().min(0).max(1),
  associateAssetsIds: z.array(z.number().int().positive()),
});

export default router.post(
  "/",
  validateFields({ data: z.array(storyboardSchema).min(1), scriptId: z.number().int().positive(), projectId: z.number().int().positive() }),
  async (req, res, next) => {
    try {
      const { data, scriptId, projectId } = req.body;
      await u.db.transaction(async (trx: any) => {
        await assertProjectScript(trx, projectId, scriptId);
        for (const item of data) {
          const [id] = await trx("o_storyboard").insert({
            prompt: item.prompt,
            duration: String(item.duration),
            state: item.state,
            scriptId,
            projectId,
            track: item.track,
            filePath: item.src ? u.replaceUrl(item.src) : null,
            videoDesc: item.videoDesc,
            shouldGenerateImage: item.shouldGenerateImage,
            createTime: Date.now(),
          });
          if (item.associateAssetsIds.length) {
            await trx("o_assets2Storyboard").insert(item.associateAssetsIds.map((assetId: number) => ({ assetId, storyboardId: id })));
          }
        }

        const allStoryboards = await trx("o_storyboard").where({ scriptId, projectId });
        if (!allStoryboards.length) throw new Error("未查到分镜数据");
        const groups = new Map<string, number[]>();
        for (const item of allStoryboards) {
          const track = String(item.track || "");
          if (!groups.has(track)) groups.set(track, []);
          groups.get(track)!.push(Number(item.id));
        }

        for (const [track, storyboardIds] of groups) {
          const trackItems = allStoryboards.filter((item: any) => String(item.track || "") === track);
          const trackDuration = trackItems.reduce((sum: number, item: any) => sum + Number(item.duration || 0), 0);
          const existing = trackItems.find((item: any) => item.trackId != null);
          let trackId = existing?.trackId ? Number(existing.trackId) : 0;
          if (trackId) {
            const affected = await trx("o_videoTrack").where({ id: trackId, scriptId, projectId }).update({ duration: trackDuration });
            if (affected !== 1) trackId = 0;
          }
          if (!trackId) {
            trackId = await createUniqueVideoTrackId(trx);
            await trx("o_videoTrack").insert({ id: trackId, scriptId, projectId, duration: trackDuration });
          }
          await trx("o_storyboard").whereIn("id", storyboardIds).update({ trackId });
        }
      });

      const finalStoryboards = await u.db("o_storyboard").where({ scriptId, projectId });
      if (!finalStoryboards.length) return res.status(400).send(error("未查到分镜数据"));
      const storyboardData = await Promise.all(finalStoryboards.map(async (item: any) => ({
        associateAssetsIds: await u.db("o_assets2Storyboard").where("storyboardId", item.id).orderBy("rowid").select("assetId").pluck("assetId"),
        src: item.filePath ? await u.oss.getSmallImageUrl(item.filePath) : "",
        id: item.id,
        trackId: item.trackId,
        prompt: item.prompt,
        duration: Number(item.duration),
        state: item.state,
        scriptId: item.scriptId,
        reason: item.reason,
        videoDesc: item.videoDesc,
      })));
      res.status(200).send(success(storyboardData));
    } catch (exception) {
      next(exception);
    }
  },
);
