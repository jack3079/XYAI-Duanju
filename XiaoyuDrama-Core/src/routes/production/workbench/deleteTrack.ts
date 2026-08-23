import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ id: z.number().int().positive() }),
  async (req, res) => {
    const { id } = req.body;
    const track = await u.db("o_videoTrack").where({ id }).first();
    if (!track) return res.status(404).send(error("视频轨道不存在或已删除"));

    const running = await u.db("o_video").where({ videoTrackId: id, state: "生成中" }).first("id");
    if (running) return res.status(409).send(error("该轨道仍有视频正在生成，不能删除"));

    const videos = await u.db("o_video").where({ videoTrackId: id }).select("id", "filePath");
    await u.db.transaction(async (trx: any) => {
      await trx("o_storyboard").where({ trackId: id }).update({ trackId: null, track: null });
      await trx("o_video").where({ videoTrackId: id }).delete();
      const affected = await trx("o_videoTrack").where({ id }).delete();
      if (affected !== 1) throw new Error("视频轨道已变化，请刷新后重试");
    });

    for (const video of videos) {
      if (!video.filePath) continue;
      try {
        if (await u.oss.fileExists(video.filePath)) await u.oss.deleteFile(video.filePath);
      } catch (exception) {
        console.warn(`[轨道删除] 清理视频文件失败 ${video.filePath}:`, u.error(exception).message);
      }
    }
    res.status(200).send(success({ message: "视频段删除成功" }));
  },
);
