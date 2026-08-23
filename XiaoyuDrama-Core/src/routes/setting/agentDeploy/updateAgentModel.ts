import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    name: z.string(),
    model: z.string(),
    modelName: z.string(),
    vendorId: z.string().nullable(),
    desc: z.string(),
    temperature: z.number().optional(),
    maxOutputTokens: z.number().optional(),
  }),
  async (req, res) => {
    const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = req.body;
    const affected = await u.db("o_agentDeploy").where({ id }).update({ name, model, modelName, vendorId, desc, temperature, maxOutputTokens });
    if (affected !== 1) {
      return res.status(404).send(error(`Agent 配置不存在或已变化（id=${id}），请刷新页面后重新保存`));
    }
    res.status(200).send(success("配置成功"));
  },
);
