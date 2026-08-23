import express from "express";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");
const modelSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string().trim().min(1), modelName: z.string().trim().min(1), type: z.literal("text"), think: z.boolean() }),
  z.object({ name: z.string().trim().min(1), modelName: z.string().trim().min(1), type: z.literal("image"), mode: z.array(z.enum(["text", "singleImage", "multiReference"])).min(1) }),
  z.object({
    name: z.string().trim().min(1), modelName: z.string().trim().min(1), type: z.literal("video"),
    mode: z.array(z.union([
      z.enum(["singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text", "audioReference", "videoReference"]),
      z.array(z.string().regex(/^(videoReference|imageReference|audioReference):\d+$/)).min(1),
    ])).min(1),
    audio: z.union([z.literal("optional"), z.boolean()]),
    durationResolutionMap: z.array(z.object({ duration: z.array(z.number().positive()).min(1), resolution: z.array(z.string().trim().min(1)).min(1) })).min(1),
  }),
]);

function parseModels(value: unknown): any[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("供应商自定义模型配置已损坏，请先修复供应商配置");
  }
}
function assertCapability(id: string, type: string): void {
  const exports = u.vm(transform(u.vendor.getCode(id), { transforms: ["typescript"] }).code);
  const fn = type === "text" ? "textRequest" : type === "image" ? "imageRequest" : "videoRequest";
  if (typeof exports?.[fn] !== "function") throw new Error(`供应商脚本未实现 ${fn}，不能添加 ${type} 模型`);
}

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema, model: modelSchema }),
  async (req, res) => {
    try {
      const { id, model } = req.body;
      const row = await u.db("o_vendorConfig").where("id", id).first("id", "models");
      if (!row) return res.status(404).send(error("供应商不存在，请刷新页面"));
      assertCapability(id, model.type);

      const allModels = await u.vendor.getModelList(id);
      if (allModels.some((item: any) => String(item?.modelName || "") === model.modelName)) {
        return res.status(409).send(error(`模型标识已存在：${model.modelName}`));
      }
      const customModels = parseModels(row.models);
      customModels.push(model);
      const affected = await u.db("o_vendorConfig").where("id", id).update({ models: JSON.stringify(customModels) });
      if (affected !== 1) return res.status(409).send(error("供应商配置已变化，请刷新后重试"));
      res.status(200).send(success("模型添加成功"));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
