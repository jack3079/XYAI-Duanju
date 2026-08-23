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
    url: z.string().max(10000),
    flowId: z.number().int().nonnegative(),
  }),
  async (req, res) => {
    const { id, url, flowId } = req.body;
    const filePath = u.replaceUrl(url);
    if (url.trim() && !filePath) return res.status(400).send(error("分镜图片地址无效"));

    const affected = await u.db("o_storyboard").where({ id }).update({
      filePath: filePath || null,
      flowId,
      state: filePath ? "已完成" : "未生成",
      reason: null,
      shouldGenerateImage: filePath ? 1 : 0,
    });
    if (affected !== 1) return res.status(404).send(error("分镜不存在，请刷新页面"));
    res.status(200).send(success({ message: "更新分镜成功" }));
  },
);
