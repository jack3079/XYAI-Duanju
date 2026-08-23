import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    prompt: z.string().max(20000),
  }),
  async (req, res) => {
    const { id, prompt } = req.body;
    const track = await u.db("o_videoTrack").where({ id }).first("id", "state");
    if (!track) return res.status(404).send(error("视频轨道不存在，请刷新页面"));
    if (track.state === "生成中") return res.status(409).send(error("轨道正在生成内容，请等待当前任务结束后再编辑提示词"));

    const affected = await u.db("o_videoTrack").where({ id }).update({ prompt, reason: null });
    if (affected !== 1) return res.status(409).send(error("视频轨道已变化，请刷新后重试"));
    res.status(200).send(success("更新成功"));
  },
);
