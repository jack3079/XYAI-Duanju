import axios from "axios";
import { generateText } from "ai";
import { transform } from "sucrase";
import u from "@/utils";
import { getXiaoyuAccessToken } from "@/xiaoyu/computeCenterClient";

export type ProviderTestType = "text" | "image" | "video";

export interface ProviderTestResult {
  type: ProviderTestType;
  text?: string;
  base64?: string;
}

export class ProviderTestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ProviderTestError";
  }
}

function parseInputs(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item ?? "")]));
  } catch {
    throw new ProviderTestError(400, "供应商 API 配置已损坏，请重新保存配置");
  }
}

function mediaTimeoutMs(): number {
  const parsed = Number(process.env.XIAOYU_MEDIA_DOWNLOAD_TIMEOUT_MS || 120000);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 5000), 600000) : 120000;
}

async function normalizeMedia(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim()) throw new ProviderTestError(502, "供应商未返回媒体数据");
  const result = value.trim();
  if (!/^https?:\/\//i.test(result)) return result;
  try {
    const response = await axios.get(result, {
      responseType: "arraybuffer",
      timeout: mediaTimeoutMs(),
      maxRedirects: 5,
      maxContentLength: 1024 * 1024 * 1024,
      maxBodyLength: 1024 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const buffer = Buffer.from(response.data);
    if (!buffer.length) throw new Error("媒体文件为空");
    return buffer.toString("base64");
  } catch (error) {
    throw new ProviderTestError(502, `下载测试媒体失败：${u.error(error).message}`);
  }
}

function validateRequiredInputs(vendor: any, values: Record<string, string>): void {
  const missing = (Array.isArray(vendor?.inputs) ? vendor.inputs : [])
    .filter((item: any) => item?.required)
    .filter((item: any) => !String(values[String(item?.key || "")] || "").trim())
    .map((item: any) => String(item?.label || item?.key || "未知字段"));
  if (missing.length) throw new ProviderTestError(400, `请先填写必填 API 配置：${missing.join("、")}`);
}

async function prepare(id: string, modelName: string, type: ProviderTestType) {
  const config = await u.db("o_vendorConfig").where("id", id).first();
  if (!config) throw new ProviderTestError(404, "未找到该供应商配置");

  const models = await u.vendor.getModelList(id);
  const selected = models.find((item: any) => String(item?.modelName || "") === modelName);
  if (!selected) throw new ProviderTestError(404, `未找到模型 ${modelName}`);
  if (String(selected?.type || "") !== type) {
    throw new ProviderTestError(400, `模型类型不匹配：期望 ${type}，实际 ${selected?.type || "未知"}`);
  }

  const code = u.vendor.getCode(id);
  if (!code.trim()) throw new ProviderTestError(400, "供应商脚本不存在");
  let running: any;
  try {
    running = u.vm(transform(code, { transforms: ["typescript"] }).code);
  } catch (error) {
    throw new ProviderTestError(400, `供应商脚本加载失败：${u.error(error).message}`);
  }
  if (!running?.vendor) throw new ProviderTestError(400, "供应商脚本未导出 vendor 对象");

  const values = parseInputs(config.inputValues);
  validateRequiredInputs(running.vendor, values);
  if (!running.vendor.inputValues || typeof running.vendor.inputValues !== "object" || Array.isArray(running.vendor.inputValues)) {
    running.vendor.inputValues = {};
  }
  Object.assign(running.vendor.inputValues, values);
  if (id === "xiaoyu_compute_center") {
    running.vendor.inputValues.apiKey = await getXiaoyuAccessToken();
    running.vendor.inputValues.productId = "xiaoyu-drama";
  }
  running.vendor.models = models;
  return { running, selected };
}

export async function testProviderModel(id: string, modelName: string, type: ProviderTestType): Promise<ProviderTestResult> {
  const { running, selected } = await prepare(id, modelName, type);
  try {
    if (type === "text") {
      if (typeof running.textRequest !== "function") throw new ProviderTestError(400, "供应商脚本未实现 textRequest");
      const languageModel = await running.textRequest(selected, !!selected.think, 0);
      const result = await generateText({ model: languageModel, prompt: "请只回复：OK", maxOutputTokens: 64 } as any);
      const text = String(result?.text || "").trim();
      if (!text) throw new ProviderTestError(502, "文本模型未返回内容");
      return { type, text };
    }

    if (type === "image") {
      if (typeof running.imageRequest !== "function") throw new ProviderTestError(400, "供应商脚本未实现 imageRequest");
      const value = await running.imageRequest({
        prompt: "一只橙色猫坐在窗边，柔和自然光，高清摄影风格",
        referenceList: [],
        size: "1K",
        aspectRatio: "16:9",
      }, selected);
      return { type, base64: await normalizeMedia(value) };
    }

    if (typeof running.videoRequest !== "function") throw new ProviderTestError(400, "供应商脚本未实现 videoRequest");
    const maps = Array.isArray(selected?.durationResolutionMap) ? selected.durationResolutionMap : [];
    const first = maps.find((item: any) => Array.isArray(item?.duration) && item.duration.length > 0 && Array.isArray(item?.resolution) && item.resolution.length > 0);
    if (!first) throw new ProviderTestError(400, "视频模型缺少可用的 durationResolutionMap");
    const value = await running.videoRequest({
      duration: Number(first.duration[0]),
      resolution: String(first.resolution[0]),
      aspectRatio: "16:9",
      prompt: "A calm cinematic shot of a cat walking through a sunlit room.",
      referenceList: [],
      audio: false,
      mode: ["text"],
    }, selected);
    return { type, base64: await normalizeMedia(value) };
  } catch (error) {
    if (error instanceof ProviderTestError) throw error;
    throw new ProviderTestError(502, `模型调用失败：${u.error(error).message}`);
  }
}
