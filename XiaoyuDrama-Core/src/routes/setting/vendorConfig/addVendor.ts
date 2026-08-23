import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 只能包含英文、数字、点、下划线和短横线");

const vendorConfigSchema = z.object({
  id: vendorIdSchema,
  author: z.string(),
  description: z.string().optional(),
  name: z.string(),
  icon: z.string().optional(),
  inputs: z.array(z.object({
    key: z.string(), label: z.string(), type: z.enum(["text", "password", "url"]), required: z.boolean(), placeholder: z.string().optional(),
  })),
  inputValues: z.record(z.string(), z.string()),
  models: z.array(z.discriminatedUnion("type", [
    z.object({ name: z.string(), modelName: z.string(), type: z.literal("text"), think: z.boolean() }),
    z.object({ name: z.string(), modelName: z.string(), type: z.literal("image"), mode: z.array(z.enum(["text", "singleImage", "multiReference"])) }),
    z.object({
      name: z.string(), modelName: z.string(), type: z.literal("video"),
      mode: z.array(z.union([
        z.enum(["singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text", "audioReference", "videoReference"]),
        z.array(z.string().regex(/^(videoReference|imageReference|audioReference):\d+$/)),
      ])),
      audio: z.union([z.literal("optional"), z.boolean()]),
      durationResolutionMap: z.array(z.object({ duration: z.array(z.number()), resolution: z.array(z.string()) })),
    }),
  ])),
});

function validateCapabilities(exports: any, models: Array<{ type: string }>): string | null {
  const declared = new Set(models.map((model) => model.type));
  if (declared.has("text") && !exports.textRequest) return "已声明文本模型，但脚本未导出 textRequest";
  if (declared.has("image") && !exports.imageRequest) return "已声明图片模型，但脚本未导出 imageRequest";
  if (declared.has("video") && !exports.videoRequest) return "已声明视频模型，但脚本未导出 videoRequest";
  return null;
}

export default router.post(
  "/",
  validateFields({ tsCode: z.string().min(1) }),
  async (req, res) => {
    const { tsCode } = req.body;
    try {
      const jsCode = transform(tsCode, { transforms: ["typescript"] }).code;
      const exports = u.vm(jsCode);
      if (!exports?.vendor) return res.status(400).send(error("脚本文件必须导出 vendor 对象"));
      const result = vendorConfigSchema.safeParse(exports.vendor);
      if (!result.success) {
        const details = result.error.issues.map((issue, index) => `${index + 1}. ${issue.path.join(".") || "root"}: ${issue.message}`).join("\n");
        return res.status(400).send(error(`vendor 配置校验失败：\n${details}`));
      }
      const capabilityError = validateCapabilities(exports, result.data.models);
      if (capabilityError) return res.status(400).send(error(capabilityError));

      const vendor = result.data;
      const existing = await u.db("o_vendorConfig").where("id", vendor.id).first("id");
      if (existing) return res.status(409).send(error("供应商 id 已存在"));

      u.vendor.writeCode(vendor.id, tsCode);
      try {
        await u.db("o_vendorConfig").insert({
          id: vendor.id,
          inputValues: JSON.stringify(vendor.inputValues ?? {}),
          models: JSON.stringify([]),
          enable: 0,
        });
      } catch (dbError) {
        try { u.vendor.deleteCode(vendor.id); } catch { /* ignore rollback cleanup */ }
        throw dbError;
      }
      res.status(200).send(success(vendor));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
