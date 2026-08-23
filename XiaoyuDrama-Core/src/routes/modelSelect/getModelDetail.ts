import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ modelId: z.string().trim().min(3) }),
  async (req, res) => {
    const modelId = String(req.body.modelId || "").trim();
    const [id, name] = modelId.split(/:(.+)/);
    if (!id || !name) return res.status(400).send(error("模型标识格式错误，应为 provider:model"));
    try {
      const models = await u.vendor.getModelList(id);
      const found = models.find((item: any) => String(item?.modelName) === name);
      if (!found) return res.status(404).send(error(`模型不存在：${modelId}`));
      res.status(200).send(success(found));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
