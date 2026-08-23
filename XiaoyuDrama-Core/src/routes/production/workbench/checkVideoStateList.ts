import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    videoIds: z.array(z.number().int().positive()).max(500),
  }),
  async (req, res) => {
    const { projectId, scriptId, videoIds } = req.body;
    if (!videoIds.length) return res.status(200).send(success([]));

    const uniqueIds = [...new Set<number>(videoIds)];
    const videoList = await u
      .db("o_video")
      .where({ projectId, scriptId })
      .whereIn("id", uniqueIds)
      .whereIn("state", ["生成成功", "生成失败"])
      .select("id", "videoTrackId", "state", "errorReason", "filePath");

    res.status(200).send(success(await Promise.all(videoList.map(async (item) => ({
      ...item,
      src: item.filePath && item.state === "生成成功" && await u.oss.fileExists(item.filePath)
        ? await u.oss.getFileUrl(item.filePath)
        : "",
    }))));
  },
);
