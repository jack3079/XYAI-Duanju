import { generateText, streamText, wrapLanguageModel, stepCountIs, extractReasoningMiddleware } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import axios from "axios";
import { transform } from "sucrase";
import u from "@/utils";
import { getXiaoyuExecutionContext, runWithXiaoyuExecutionContext } from "@/xiaoyu/executionContext";
import { getXiaoyuAccessToken } from "@/xiaoyu/computeCenterClient";

type AiType =
  | "scriptAgent"
  | "productionAgent"
  | "universalAi"
  | "scriptAgent:decisionAgent"
  | "scriptAgent:supervisionAgent"
  | "scriptAgent:storySkeletonAgent"
  | "scriptAgent:adaptationStrategyAgent"
  | "scriptAgent:scriptAgent"
  | "productionAgent:decisionAgent"
  | "productionAgent:supervisionAgent"
  | "productionAgent:deriveAssetsAgent"
  | "productionAgent:generateAssetsAgent"
  | "productionAgent:directorPlanAgent"
  | "productionAgent:storyboardGenAgent"
  | "productionAgent:storyboardPanelAgent"
  | "productionAgent:storyboardTableAgent";

type FnName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";
type ModelType = "text" | "image" | "video";

const AiTypeValues: AiType[] = [
  "scriptAgent",
  "productionAgent",
  "universalAi",
  "scriptAgent:decisionAgent",
  "scriptAgent:supervisionAgent",
  "scriptAgent:storySkeletonAgent",
  "scriptAgent:adaptationStrategyAgent",
  "scriptAgent:scriptAgent",
  "productionAgent:decisionAgent",
  "productionAgent:supervisionAgent",
  "productionAgent:deriveAssetsAgent",
  "productionAgent:generateAssetsAgent",
  "productionAgent:directorPlanAgent",
  "productionAgent:storyboardGenAgent",
  "productionAgent:storyboardPanelAgent",
  "productionAgent:storyboardTableAgent",
];

function splitModelRef(value: string): [string, string] {
  const match = String(value || "").match(/^([^:]+):(.+)$/);
  if (!match) throw new Error(`模型路由格式无效：${value}，应为 provider:model`);
  return [match[1], match[2]];
}

async function resolveModelName(value: AiType | `${string}:${string}`): Promise<`${string}:${string}`> {
  if (!AiTypeValues.includes(value as AiType)) return value as `${string}:${string}`;

  const mode = await u.db("o_setting").where("key", "agentUseMode").first();
  if (mode?.value === "1") {
    const row = await u.db("o_agentDeploy").where("key", value).first();
    if (!row?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
    return row.modelName;
  }

  if (mode?.value === "0") {
    const [main] = String(value).split(/:(.+)/);
    const row = await u.db("o_agentDeploy").where("key", main).first();
    if (!row?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
    return row.modelName;
  }

  const row = await u.db("o_agentDeploy").where("key", value).first();
  if (row?.modelName) return row.modelName;
  const [main] = String(value).split(/:(.+)/);
  const fallback = await u.db("o_agentDeploy").where("key", main).first();
  if (!fallback?.modelName) throw new Error(`未找到部署配置 ${value}；请在 设置 → Agent 配置 中选择文本模型`);
  return fallback.modelName;
}

async function getModelConfig(value: AiType | `${string}:${string}`) {
  if (!AiTypeValues.includes(value as AiType)) return null;

  const mode = await u.db("o_setting").where("key", "agentUseMode").first();
  if (mode?.value === "1") {
    const row = await u.db("o_agentDeploy").where("key", value).first();
    if (!row?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
    return row;
  }

  if (mode?.value === "0") {
    const [main] = String(value).split(/:(.+)/);
    const row = await u.db("o_agentDeploy").where("key", main).first();
    if (!row?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
    return row;
  }

  const row = await u.db("o_agentDeploy").where("key", value).first();
  if (row?.modelName) return row;
  const [main] = String(value).split(/:(.+)/);
  const fallback = await u.db("o_agentDeploy").where("key", main).first();
  if (!fallback?.modelName) throw new Error(`未找到部署配置 ${value}；请在 设置 → Agent 配置 中选择文本模型`);
  return fallback;
}

function parseVendorInputs(value: unknown, id: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`AI Provider ${id} 的 API 配置数据已损坏，请重新保存供应商配置`);
  }
}

function expectedModelType(fnName: FnName): ModelType | null {
  if (fnName === "textRequest") return "text";
  if (fnName === "imageRequest") return "image";
  if (fnName === "videoRequest") return "video";
  return null;
}

async function getVendorTemplateFn(
  fnName: "textRequest",
  modelName: `${string}:${string}`,
): Promise<(think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => any>;
async function getVendorTemplateFn(
  fnName: Exclude<FnName, "textRequest">,
  modelName: `${string}:${string}`,
): Promise<(input: any) => any>;
async function getVendorTemplateFn(fnName: FnName, modelName: `${string}:${string}`): Promise<any> {
  const [id, name] = splitModelRef(modelName);
  const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();
  if (!vendorConfigData) throw new Error(`未找到 AI Provider：${id}`);
  if (Number(vendorConfigData.enable || 0) !== 1) throw new Error(`AI Provider 未启用：${id}`);

  const modelList = await u.vendor.getModelList(id);
  const selectedModel = modelList.find((item: any) => String(item?.modelName || "") === name);
  if (!selectedModel) throw new Error(`AI Provider ${id} 中未找到模型：${name}`);

  const expectedType = expectedModelType(fnName);
  if (expectedType && String(selectedModel?.type || "") !== expectedType) {
    throw new Error(`模型 ${modelName} 类型为 ${selectedModel?.type || "未知"}，当前调用需要 ${expectedType} 模型`);
  }

  const code = u.vendor.getCode(id);
  if (!code.trim()) throw new Error(`AI Provider 脚本不存在：${id}`);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const running = u.vm(jsCode);
  if (!running?.vendor) throw new Error(`AI Provider 脚本未导出 vendor：${id}`);

  if (!running.vendor.inputValues || typeof running.vendor.inputValues !== "object" || Array.isArray(running.vendor.inputValues)) {
    running.vendor.inputValues = {};
  }
  Object.assign(running.vendor.inputValues, parseVendorInputs(vendorConfigData.inputValues, id));

  if (id === "xiaoyu_compute_center") {
    const context = getXiaoyuExecutionContext();
    Object.assign(running.vendor.inputValues, {
      apiKey: await getXiaoyuAccessToken(),
      productId: "xiaoyu-drama",
      qualityMode: context?.qualityMode || "",
      policyVersion: context?.policyVersion || "",
      projectRef: context?.projectRef || "",
      runId: context?.runId || "",
      nodeKey: context?.nodeKey || "",
      stageRef: context?.stageRef || "",
      entityType: context?.entityType || "",
      entityId: context?.entityId === undefined ? "" : String(context.entityId),
      idempotencyScope: context?.idempotencyScope || "",
    });
  }
  running.vendor.models = modelList;

  const fn = running[fnName];
  if (typeof fn !== "function") throw new Error(`AI Provider ${id} 未实现 ${fnName}`);
  if (fnName === "textRequest") {
    return (think?: boolean, thinkLevel: 0 | 1 | 2 | 3 = 0) => fn(selectedModel, think ?? !!selectedModel.think, thinkLevel);
  }
  return <T>(input: T) => fn(input, selectedModel);
}

async function finishTaskRecord(done: (state: 1 | -1, reason?: string) => Promise<void>, state: 1 | -1, reason?: string) {
  try {
    await done(state, reason);
  } catch (error) {
    console.error("[taskRecord] 更新任务状态失败", error);
  }
}

async function withTaskRecord<T>(
  modelKey: AiType | `${string}:${string}`,
  taskClass: string,
  describe: string,
  relatedObjects: string,
  projectId: number,
  fn: (modelName: `${string}:${string}`, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => Promise<T>,
): Promise<T> {
  const modelName = await resolveModelName(modelKey);
  const [, model] = splitModelRef(modelName);
  const done = await u.task(projectId, taskClass, model, { describe, content: relatedObjects });
  try {
    const project = await u.db("o_project").where("id", projectId).first();
    if (!project) throw new Error(`项目不存在：${projectId}`);
    const current = getXiaoyuExecutionContext();
    const result = current
      ? await fn(modelName, false, 0)
      : await runWithXiaoyuExecutionContext(
          {
            requestId: `xyreq_${u.uuid()}`,
            projectId,
            projectRef: String(projectId),
            qualityMode: project?.qualityMode as any,
            policyVersion: project?.computePresetVersion || undefined,
            stageRef: taskClass,
            entityType: "task",
            entityId: relatedObjects,
            idempotencyScope: `${projectId}:${taskClass}:${relatedObjects}`,
          },
          () => fn(modelName, false, 0),
        );
    await finishTaskRecord(done, 1);
    return result;
  } catch (error) {
    const message = u.error(error).message;
    await finishTaskRecord(done, -1, message);
    if (error instanceof Error) throw error;
    throw new Error(message);
  }
}

function mediaDownloadTimeoutMs(): number {
  const value = Number(process.env.XIAOYU_MEDIA_DOWNLOAD_TIMEOUT_MS || 120000);
  if (!Number.isFinite(value)) return 120000;
  return Math.min(Math.max(Math.trunc(value), 5000), 600000);
}

async function urlToBase64(url: string, retries = 3, delay = 1000): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`供应商返回了无效媒体 URL：${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`不支持的媒体 URL 协议：${parsed.protocol}`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: mediaDownloadTimeoutMs(),
        maxRedirects: 5,
        maxContentLength: 1024 * 1024 * 1024,
        maxBodyLength: 1024 * 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const buffer = Buffer.from(response.data);
      if (!buffer.length) throw new Error("远程媒体文件为空");
      return buffer.toString("base64");
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
  throw new Error(`下载供应商媒体失败：${u.error(lastError).message}`);
}

function textGenerationOptions(config: any): Record<string, unknown> {
  const options: Record<string, unknown> = {
    maxOutputTokens: Number(config?.maxOutputTokens) > 0 ? Number(config.maxOutputTokens) : 32768,
  };
  if (config?.temperature !== null && config?.temperature !== undefined && config?.temperature !== "") {
    const temperature = Number(config.temperature);
    if (Number.isFinite(temperature)) options.temperature = temperature;
  }
  return options;
}

function toolStopOption(input: { tools?: Record<string, unknown> }): Record<string, unknown> {
  const count = input.tools ? Object.keys(input.tools).length : 0;
  return count > 0 ? { stopWhen: stepCountIs(count * 50) } : {};
}

class AiText {
  constructor(
    private AiType: AiType | `${string}:${string}`,
    private think?: boolean,
    private thinkLevel: 0 | 1 | 2 | 3 = 0,
  ) {}

  private async resolveModel(middleware?: any | any[]) {
    const sw = await u.db("o_setting").where("key", "switchAiDevTool").first();
    const modelName = await resolveModelName(this.AiType);
    const sdkFn = await getVendorTemplateFn("textRequest", modelName);
    const baseModel = await sdkFn(this.think, this.thinkLevel);
    const middlewares = [
      ...(sw?.value === "1" ? [devToolsMiddleware()] : []),
      ...(middleware ? (Array.isArray(middleware) ? middleware : [middleware]) : []),
    ];
    return middlewares.length
      ? wrapLanguageModel({ model: baseModel, middleware: middlewares.length === 1 ? middlewares[0] : middlewares })
      : baseModel;
  }

  async invoke(input: Omit<Parameters<typeof generateText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    return generateText({
      ...input,
      ...toolStopOption(input as any),
      model: await this.resolveModel(),
      ...textGenerationOptions(config),
    } as any);
  }

  async stream(input: Omit<Parameters<typeof streamText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    return streamText({
      ...input,
      ...toolStopOption(input as any),
      model: await this.resolveModel(extractReasoningMiddleware({ tagName: "reasoning_content", separator: "\n" })),
      ...textGenerationOptions(config),
    } as any);
  }
}

function referenceList2imageBase642(id: string, input: any) {
  const version = u.vendor.getVendor(id)?.version;
  if (!version || isNaN(parseFloat(version)) || parseFloat(version) < 2.0) {
    if (Array.isArray(input.referenceList)) {
      input.imageBase64 = input.referenceList.map((item: any) => item?.base64).filter(Boolean);
    }
  }
  return input;
}

async function normalizeMediaResult(kind: "图片" | "视频" | "音频", value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${kind}供应商未返回${kind}数据`);
  const result = value.trim();
  if (/^https?:\/\//i.test(result)) return urlToBase64(result);
  return result;
}

export type ReferenceList =
  | { type: "image"; base64: string }
  | { type: "audio"; base64: string }
  | { type: "video"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface TaskRecord {
  taskClass: string;
  describe: string;
  relatedObjects: string;
  projectId: number;
}

class AiImage {
  private result = "";
  constructor(private key: `${string}:${string}`) {}

  async run(input: ImageConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    const exec = async (mn: `${string}:${string}`) => {
      const fn = await getVendorTemplateFn("imageRequest", mn);
      referenceList2imageBase642(splitModelRef(mn)[0], input);
      this.result = await normalizeMediaResult("图片", await fn(input));
      return this;
    };
    if (taskRecord) await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
    else await exec(modelName);
    return this;
  }

  async save(filePath: string) {
    await u.oss.writeFile(filePath, this.result);
    return this;
  }
}

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

class AiVideo {
  private result = "";
  constructor(private key: `${string}:${string}`) {}

  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    const exec = async (mn: `${string}:${string}`) => {
      const fn = await getVendorTemplateFn("videoRequest", mn);
      referenceList2imageBase642(splitModelRef(mn)[0], input);
      this.result = await normalizeMediaResult("视频", await fn(input));
      return this;
    };
    if (taskRecord) await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
    else await exec(modelName);
    return this;
  }

  async save(filePath: string) {
    await u.oss.writeFile(filePath, this.result);
    return this;
  }
}

class AiAudio {
  private result = "";
  constructor(private key: `${string}:${string}`) {}

  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    const exec = async (mn: `${string}:${string}`) => {
      const fn = await getVendorTemplateFn("ttsRequest", mn);
      referenceList2imageBase642(splitModelRef(mn)[0], input);
      this.result = await normalizeMediaResult("音频", await fn(input));
      return this;
    };
    if (taskRecord) return withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
    return exec(modelName);
  }

  async save(filePath: string) {
    await u.oss.writeFile(filePath, this.result);
    return this;
  }
}

export default {
  Text: (type: AiType | `${string}:${string}`, think?: boolean, level?: 0 | 1 | 2 | 3) => new AiText(type, think, level),
  Image: (key: `${string}:${string}`) => new AiImage(key),
  Video: (key: `${string}:${string}`) => new AiVideo(key),
  Audio: (key: `${string}:${string}`) => new AiAudio(key),
};
