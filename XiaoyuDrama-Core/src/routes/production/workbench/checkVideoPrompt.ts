import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    trackIds: z.array(z.number().int().positive()).max(500),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body;
    const trackIds = [...new Set<number>(req.body.trackIds)];
    if (!trackIds.length) return res.status(200).send(success([]));
    if (trackIds.length !== req.body.trackIds.length) return res.status(400).send(error("提示词轮询包含重复轨道 id"));

    const script = await u.db("o_script").where({ id: scriptId, projectId }).first("id");
    if (!script) return res.status(404).send(error("剧集不存在或不属于当前项目"));

    const promptList = await u
      .db("o_videoTrack")
      .where({ projectId, scriptId })
      .whereIn("id", trackIds)
      .whereIn("state", ["已完成", "生成失败"])
      .select("id", "state", "reason", "prompt");
    res.status(200).send(success(promptList));
  },
);
