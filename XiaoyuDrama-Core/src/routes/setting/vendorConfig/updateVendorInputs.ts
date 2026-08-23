import express from "express";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");

function parseObject(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item ?? "")]));
  } catch {
    return {};
  }
}

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema, inputValues: z.record(z.string(), z.string()) }),
  async (req, res) => {
    try {
      const { id, inputValues } = req.body;
      const row = await u.db("o_vendorConfig").where("id", id).first("id", "inputValues");
      if (!row) return res.status(404).send(error("供应商不存在，请刷新页面"));

      const vendor = u.vendor.getVendor(id);
      const allowedKeys = new Set((Array.isArray(vendor?.inputs) ? vendor.inputs : []).map((item: any) => String(item?.key || "")).filter(Boolean));
      const unknownKeys = Object.keys(inputValues).filter((key) => !allowedKeys.has(key));
      if (unknownKeys.length) return res.status(400).send(error(`供应商不支持这些配置字段：${unknownKeys.join("、")}`));

      const merged = { ...parseObject(row.inputValues), ...inputValues };
      const affected = await u.db("o_vendorConfig").where("id", id).update({ inputValues: JSON.stringify(merged) });
      if (affected !== 1) return res.status(409).send(error("供应商配置已变化，请刷新后重试"));
      res.status(200).send(success("配置保存成功"));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
