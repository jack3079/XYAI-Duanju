import express from "express";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";

const router = express.Router();
const XIAOYU_VENDOR_ID = "xiaoyu_compute_center";
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");

function parseObject(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item ?? "")]));
  } catch {
    return {};
  }
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const existing = await u.db("o_setting").where({ key }).first("key");
  if (existing) await u.db("o_setting").where({ key }).update({ value });
  else await u.db("o_setting").insert({ key, value });
}

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema, enable: z.union([z.literal(0), z.literal(1)]) }),
  async (req, res) => {
    try {
      const { id, enable } = req.body;
      const row = await u.db("o_vendorConfig").where("id", id).first("id", "inputValues");
      if (!row) return res.status(404).send(error("供应商不存在，请刷新页面"));

      if (enable === 1) {
        const vendor = u.vendor.getVendor(id); // 先确认脚本可编译/可加载。
        const values = parseObject(row.inputValues);
        if (id === XIAOYU_VENDOR_ID) {
          const missing = ["baseUrl", "credential"].filter((key) => !String(values[key] || "").trim());
          if (missing.length) return res.status(400).send(error("请先在小鱼智算中心页面完成 API 地址和 Token 配置"));
        } else {
          const requiredInputs = (Array.isArray(vendor?.inputs) ? vendor.inputs : []).filter((item: any) => item?.required);
          const missing = requiredInputs.filter((item: any) => !String(values[String(item.key)] || "").trim()).map((item: any) => String(item.label || item.key));
          if (missing.length) return res.status(400).send(error(`请先填写必填 API 配置：${missing.join("、")}`));
        }
      }

      const affected = await u.db("o_vendorConfig").where("id", id).update({ enable });
      if (affected !== 1) return res.status(409).send(error("供应商状态已变化，请刷新后重试"));
      if (id === XIAOYU_VENDOR_ID) await upsertSetting("xiaoyuComputeCenterEnabled", enable === 1 ? "1" : "0");
      res.status(200).send(success(enable === 1 ? "供应商已启用" : "供应商已停用"));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
