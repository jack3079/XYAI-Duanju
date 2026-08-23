import express from "express";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");
const modelSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string().trim().min(1), modelName: z.string().trim().min(1), type: z.literal("text"), think: z.boolean() }),
  z.object({ name: z.string().trim().min(1), modelName: z.string().trim().min(1), type: z.literal("image"), mode: z.array(z.enum(["text", "singleImage", "multiReference"])) }),
  z.object({
    name: z.string().trim().min(1), modelName: z.string().trim().min(1), type: z.literal("video"),
    mode: z.array(z.union([
      z.enum(["singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text", "audioReference", "videoReference"]),
      z.array(z.string().regex(/^(videoReference|imageReference|audioReference):\d+$/)),
    ])),
    audio: z.union([z.literal("optional"), z.boolean()]),
    durationResolutionMap: z.array(z.object({ duration: z.array(z.number()), resolution: z.array(z.string()) })),
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

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema, modelName: z.string().trim().min(1), model: modelSchema }),
  async (req, res) => {
    try {
      const { id, modelName, model } = req.body;
      const row = await u.db("o_vendorConfig").where("id", id).first("id", "models");
      if (!row) return res.status(404).send(error("供应商不存在，请刷新页面"));

      const customModels = parseModels(row.models);
      const vendor = u.vendor.getVendor(id);
      const builtInModels = Array.isArray(vendor?.models) ? vendor.models : [];
      const customIndex = customModels.findIndex((item: any) => String(item?.modelName || "") === modelName);
      const builtInHasOld = builtInModels.some((item: any) => String(item?.modelName || "") === modelName);
      if (customIndex < 0 && !builtInHasOld) return res.status(404).send(error(`模型不存在：${modelName}`));

      const targetName = String(model.modelName || "");
      if (customIndex < 0 && builtInHasOld && targetName !== modelName) {
        return res.status(400).send(error("内置模型的 modelName 不允许改名；可以修改显示名、参数或能力配置"));
      }
      const customConflict = customModels.some((item: any, index: number) => index !== customIndex && String(item?.modelName || "") === targetName);
      const builtInConflict = builtInModels.some((item: any) => String(item?.modelName || "") === targetName) && !(builtInHasOld && targetName === modelName);
      if (customConflict || builtInConflict) return res.status(409).send(error(`模型标识已存在：${targetName}`));

      if (customIndex >= 0) customModels[customIndex] = model;
      else customModels.push(model); // 对内置模型创建同名覆盖项；删除覆盖项后自动恢复内置配置。

      const affected = await u.db("o_vendorConfig").where("id", id).update({ models: JSON.stringify(customModels) });
      if (affected !== 1) return res.status(409).send(error("供应商配置已变化，请刷新后重试"));
      res.status(200).send(success("模型更新成功"));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
