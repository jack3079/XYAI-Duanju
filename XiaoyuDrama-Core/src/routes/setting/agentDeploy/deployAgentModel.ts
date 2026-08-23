import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();
const itemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  model: z.string(),
  modelName: z.string(),
  vendorId: z.string().nullable(),
  desc: z.string(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
});

export default router.post(
  "/",
  validateFields({ items: z.array(itemSchema).min(1) }),
  async (req, res) => {
    const { items } = req.body;
    const ids = items.map((item: any) => Number(item.id));
    if (new Set(ids).size !== ids.length) return res.status(400).send(error("批量 Agent 配置包含重复 id"));

    const existingRows = await u.db("o_agentDeploy").whereIn("id", ids).select("id");
    const existingIds = new Set(existingRows.map((row: any) => Number(row.id)));
    const missingIds = ids.filter((id: number) => !existingIds.has(id));
    if (missingIds.length) return res.status(404).send(error(`以下 Agent 配置已不存在，请刷新页面：${missingIds.join("、")}`));

    await u.db.transaction(async (trx: any) => {
      for (const item of items) {
        const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = item;
        const affected = await trx("o_agentDeploy").where({ id }).update({ name, model, modelName, vendorId, desc, temperature, maxOutputTokens });
        if (affected !== 1) throw new Error(`Agent 配置更新失败（id=${id}）`);
      }
    });
    res.status(200).send(success("批量配置成功"));
  },
);
