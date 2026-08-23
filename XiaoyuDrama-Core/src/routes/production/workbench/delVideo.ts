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
    const video = await u.db("o_video").where({ id }).first();
    if (!video) return res.status(404).send(error("视频不存在或已删除"));
    if (video.state === "生成中") return res.status(409).send(error("视频仍在生成中，不能直接删除；请等待任务结束后再删除"));

    await u.db.transaction(async (trx: any) => {
      await trx("o_videoTrack").where("videoId", id).update({ videoId: null, selectVideoId: null });
      await trx("o_videoTrack").where("selectVideoId", id).update({ selectVideoId: null });
      const affected = await trx("o_video").where({ id }).delete();
      if (affected !== 1) throw new Error("视频记录已变化，请刷新后重试");
    });

    if (video.filePath) {
      try {
        if (await u.oss.fileExists(video.filePath)) await u.oss.deleteFile(video.filePath);
      } catch (exception) {
        console.warn(`[视频删除] 数据库已删除，但清理文件失败 ${video.filePath}:`, u.error(exception).message);
      }
    }
    res.status(200).send(success({ message: "视频删除成功" }));
  },
);
