import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    trackId: z.number().int().positive(),
    videoId: z.number().int().positive(),
  }),
  async (req, res) => {
    const { trackId, videoId } = req.body;
    const track = await u.db("o_videoTrack").where({ id: trackId }).first("id", "projectId", "scriptId");
    if (!track) return res.status(404).send(error("视频轨道不存在，请刷新页面"));

    const video = await u.db("o_video").where({ id: videoId, videoTrackId: trackId, projectId: track.projectId, scriptId: track.scriptId }).first("id", "state", "filePath");
    if (!video) return res.status(404).send(error("视频不存在或不属于当前轨道"));
    if (video.state !== "生成成功") return res.status(409).send(error(`视频尚不可选择，当前状态：${video.state || "未知"}`));
    if (!video.filePath || !(await u.oss.fileExists(video.filePath))) return res.status(409).send(error("视频文件已丢失，请重新生成"));

    const affected = await u.db("o_videoTrack").where({ id: trackId }).update({
      videoId,
      selectVideoId: videoId,
      state: "已完成",
      reason: null,
    });
    if (affected !== 1) return res.status(409).send(error("视频轨道已变化，请刷新后重试"));
    res.status(200).send(success({ message: "视频选择成功", videoId }));
  },
);
