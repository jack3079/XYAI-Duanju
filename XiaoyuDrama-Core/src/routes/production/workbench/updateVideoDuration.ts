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
    duration: z.number().nonnegative().max(3600),
  }),
  async (req, res) => {
    const { id, duration } = req.body;
    const affected = await u.db("o_videoTrack").where({ id }).update({ duration });
    if (affected !== 1) return res.status(404).send(error("视频轨道不存在，请刷新页面"));
    res.status(200).send(success("更新成功"));
  },
);
