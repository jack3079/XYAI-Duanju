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
    videoDesc: z.string().max(20000),
  }),
  async (req, res) => {
    const { id, prompt, videoDesc } = req.body;
    const affected = await u.db("o_storyboard").where({ id }).update({ prompt, videoDesc });
    if (affected !== 1) return res.status(404).send(error("分镜不存在，请刷新页面"));
    res.status(200).send(success({ message: "更新提示词成功" }));
  },
);
