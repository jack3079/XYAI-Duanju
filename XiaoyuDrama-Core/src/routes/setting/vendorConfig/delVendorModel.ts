import express from "express";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");

function parseModels(value: unknown): any[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("供应商自定义模型配置已损坏，请先修复供应商配置");
  }
}

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema, modelName: z.string().trim().min(1) }),
  async (req, res) => {
    try {
      const { id, modelName } = req.body;
      const row = await u.db("o_vendorConfig").where("id", id).first("id", "models");
      if (!row) return res.status(404).send(error("供应商不存在，请刷新页面"));

      const customModels = parseModels(row.models);
      const index = customModels.findIndex((item: any) => String(item?.modelName || "") === modelName);
      if (index < 0) {
        const vendor = u.vendor.getVendor(id);
        const builtIn = Array.isArray(vendor?.models) && vendor.models.some((item: any) => String(item?.modelName || "") === modelName);
        return res.status(builtIn ? 400 : 404).send(error(builtIn ? "内置模型不允许删除" : `模型不存在：${modelName}`));
      }
      customModels.splice(index, 1);
      const affected = await u.db("o_vendorConfig").where("id", id).update({ models: JSON.stringify(customModels) });
      if (affected !== 1) return res.status(409).send(error("供应商配置已变化，请刷新后重试"));
      res.status(200).send(success("模型删除成功"));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
