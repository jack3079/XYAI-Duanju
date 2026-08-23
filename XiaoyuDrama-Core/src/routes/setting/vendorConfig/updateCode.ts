import express from "express";
import { serializeError } from "serialize-error";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 只能包含英文、数字、点、下划线和短横线");
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
    durationResolutionMap: z.array(z.object({
      duration: z.array(z.number().positive()).min(1),
      resolution: z.array(z.string().trim().min(1)).min(1),
    })).min(1),
  }),
]);
const vendorConfigSchema = z.object({
  id: vendorIdSchema,
  author: z.string(),
  description: z.string().optional(),
  name: z.string().trim().min(1),
  icon: z.string().optional(),
  inputs: z.array(z.object({
    key: z.string().trim().min(1),
    label: z.string(),
    type: z.enum(["text", "password", "url"]),
    required: z.boolean(),
    placeholder: z.string().optional(),
  })),
  inputValues: z.record(z.string(), z.string()),
  models: z.array(modelSchema),
});

type ModelConfig = z.infer<typeof modelSchema>;

function parseJsonObject(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item ?? "")]));
  } catch {
    return {};
  }
}

function parseCustomModels(value: unknown): ModelConfig[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    const result = z.array(modelSchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function buildEffectiveModelMap(builtIn: ModelConfig[], custom: ModelConfig[]): Map<string, ModelConfig> {
  const map = new Map<string, ModelConfig>();
  for (const item of builtIn) map.set(item.modelName, item);
  for (const item of custom) map.set(item.modelName, item);
  return map;
}

function validateExportedCapabilities(exports: any, models: Iterable<ModelConfig>): string | null {
  const types = new Set([...models].map((model) => model.type));
  if (types.has("text") && typeof exports.textRequest !== "function") return "当前模型配置包含文本模型，但脚本未导出 textRequest";
  if (types.has("image") && typeof exports.imageRequest !== "function") return "当前模型配置包含图片模型，但脚本未导出 imageRequest";
  if (types.has("video") && typeof exports.videoRequest !== "function") return "当前模型配置包含视频模型，但脚本未导出 videoRequest";
  return null;
}

function modelIdFromRef(ref: unknown, vendorId: string): string {
  const value = String(ref || "").trim();
  const prefix = `${vendorId}:`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

async function validateLiveReferences(vendorId: string, models: Map<string, ModelConfig>): Promise<string[]> {
  const prefix = `${vendorId}:%`;
  const problems: string[] = [];

  const agents = await u.db("o_agentDeploy")
    .where("vendorId", vendorId)
    .orWhere("modelName", "like", prefix)
    .select("key", "name", "modelName");
  for (const row of agents) {
    const modelId = modelIdFromRef(row.modelName, vendorId);
    if (!modelId) continue;
    const model = models.get(modelId);
    const label = String(row.name || row.key || "Agent");
    if (!model) problems.push(`${label} 正在使用已被脚本删除的模型 ${modelId}`);
    else if (model.type !== "text") problems.push(`${label} 使用的 ${modelId} 已不再是 text 模型`);
  }

  const projects = await u.db("o_project")
    .where("imageModel", "like", prefix)
    .orWhere("videoModel", "like", prefix)
    .select("id", "name", "imageModel", "videoModel");
  for (const project of projects) {
    const label = `项目 ${project.name || project.id}`;
    const imageId = modelIdFromRef(project.imageModel, vendorId);
    if (imageId) {
      const model = models.get(imageId);
      if (!model) problems.push(`${label} 的图片模型 ${imageId} 已被脚本删除`);
      else if (model.type !== "image") problems.push(`${label} 的图片模型 ${imageId} 已不再是 image 模型`);
    }
    const videoId = modelIdFromRef(project.videoModel, vendorId);
    if (videoId) {
      const model = models.get(videoId);
      if (!model) problems.push(`${label} 的视频模型 ${videoId} 已被脚本删除`);
      else if (model.type !== "video") problems.push(`${label} 的视频模型 ${videoId} 已不再是 video 模型`);
    }
  }
  return problems;
}

function sanitizeInputValues(
  previous: Record<string, string>,
  declaredDefaults: Record<string, string>,
  inputs: Array<{ key: string }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const input of inputs) {
    const key = String(input.key || "").trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(previous, key)) result[key] = String(previous[key] ?? "");
    else result[key] = String(declaredDefaults[key] ?? "");
  }
  return result;
}

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema, tsCode: z.string().min(1).max(2_000_000) }),
  async (req, res) => {
    try {
      const { tsCode, id } = req.body;
      const jsCode = transform(tsCode, { transforms: ["typescript"] }).code;
      const exports = u.vm(jsCode);
      if (!exports?.vendor) return res.status(400).send(error("脚本文件必须导出 vendor 对象"));
      if (String(exports.vendor.id) !== id) return res.status(400).send(error(`请求 id(${id}) 与脚本 vendor.id(${exports.vendor.id}) 不一致`));

      const result = vendorConfigSchema.safeParse(exports.vendor);
      if (!result.success) {
        const details = result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("；");
        return res.status(400).send(error(`vendor 配置校验失败：${details}`));
      }

      const existing = await u.db("o_vendorConfig").where("id", id).first("id", "inputValues", "models");
      const customModels = existing ? parseCustomModels(existing.models) : [];
      const effectiveModels = buildEffectiveModelMap(result.data.models, customModels);
      const capabilityError = validateExportedCapabilities(exports, effectiveModels.values());
      if (capabilityError) return res.status(400).send(error(capabilityError));

      if (existing) {
        const liveProblems = await validateLiveReferences(id, effectiveModels);
        if (liveProblems.length) {
          return res.status(409).send(error(`该修改会破坏正在使用的模型配置：\n${liveProblems.slice(0, 20).join("\n")}`));
        }

        const previousInputs = parseJsonObject(existing.inputValues);
        const nextInputs = sanitizeInputValues(previousInputs, result.data.inputValues, result.data.inputs);
        const oldCode = u.vendor.getCode(id);
        u.vendor.writeCode(id, tsCode);
        try {
          const affected = await u.db("o_vendorConfig").where("id", id).update({ inputValues: JSON.stringify(nextInputs) });
          if (affected !== 1) throw new Error("供应商配置已变化，请刷新后重试");
        } catch (dbError) {
          try {
            if (oldCode.trim()) u.vendor.writeCode(id, oldCode);
            else u.vendor.deleteCode(id);
          } catch (rollbackError) {
            console.error("[Provider] 脚本回滚失败", rollbackError);
          }
          throw dbError;
        }
      } else {
        const nextInputs = sanitizeInputValues({}, result.data.inputValues, result.data.inputs);
        await u.db("o_vendorConfig").insert({
          id,
          inputValues: JSON.stringify(nextInputs),
          models: JSON.stringify([]),
          enable: 0,
        });
        try {
          u.vendor.writeCode(id, tsCode);
        } catch (exception) {
          await u.db("o_vendorConfig").where("id", id).delete();
          throw exception;
        }
      }

      res.status(200).send(success(result.data));
    } catch (exception) {
      res.status(400).send(error(serializeError(exception).message || "未知错误"));
    }
  },
);
