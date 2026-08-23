import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { normalizeAgentModelSelection } from "@/utils/agentModelValidation";

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
    temperature: z.number().finite().optional(),
    maxOutputTokens: z.number().int().nonnegative().optional(),
  }),
  async (req, res) => {
    try {
      const { id, name, desc, temperature, maxOutputTokens } = req.body;
      const exists = await u.db("o_agentDeploy").where({ id }).first("id");
      if (!exists) return res.status(404).send(error(`Agent 配置不存在（id=${id}），请刷新页面后重新保存`));

      const selection = await normalizeAgentModelSelection(req.body.vendorId, req.body.model, req.body.modelName);
      const affected = await u.db("o_agentDeploy").where({ id }).update({
        name,
        desc,
        temperature,
        maxOutputTokens,
        ...selection,
      });
      if (affected !== 1) return res.status(409).send(error(`Agent 配置已变化（id=${id}），请刷新页面后重新保存`));
      res.status(200).send(success("配置成功"));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
