/**
 * 小鱼智算中心供应商适配器
 * 小鱼Ai短剧生成系统只向小鱼智算中心提交能力别名和质量模式，不暴露真实供应商、模型或密钥。
 * @version 2.1.0
 */

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

declare const logger: (msg: string) => void;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const createOpenAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
};

const vendor: VendorConfig = {
  id: "xiaoyu_compute_center",
  version: "2.1.0",
  author: "小鱼",
  name: "小鱼智算中心",
  description:
    "## 小鱼智算中心\n\n小鱼Ai短剧生成系统统一智算入口。系统根据 **高质量 / 标准 / 省钱** 模式自动组合文本、图片、视频和语音模型。\n\n充值、账号和技术支持请联系微信：**echo169369**。",
  inputs: [
    { key: "baseUrl", label: "智算中心地址", type: "url", required: true },
    { key: "qualityMode", label: "质量模式", type: "text", required: true },
    { key: "policyVersion", label: "生产策略版本", type: "text", required: true },
    { key: "productId", label: "产品标识", type: "text", required: true },
    { key: "projectRef", label: "当前项目", type: "text", required: false },
  ],
  inputValues: {
    apiKey: "",
    credential: "",
    baseUrl: "__XIAOYU_COMPUTE_CENTER_URL__",
    qualityMode: "standard",
    policyVersion: "",
    productId: "xiaoyu-drama",
    projectRef: "",
  },
  models: [
    { name: "系统自动配置 · 创意编剧", modelName: "xy-script-creative", type: "text", think: true },
    { name: "系统自动配置 · 剧本复审", modelName: "xy-script-review", type: "text", think: true },
    { name: "系统自动配置 · 导演分镜", modelName: "xy-director", type: "text", think: true },
    { name: "系统自动配置 · 通用处理", modelName: "xy-general", type: "text", think: false },
    {
      name: "系统自动配置 · 图片生成",
      modelName: "xy-image-auto",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "系统自动配置 · 视频生成",
      modelName: "xy-video-auto",
      type: "video",
      mode: ["text", "singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [
        { duration: [3, 4, 5, 6, 7, 8, 9, 10], resolution: ["480p", "720p", "1080p"] },
        { duration: [11, 12, 13, 14, 15], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "系统自动配置 · 智能配音",
      modelName: "xy-tts-auto",
      type: "tts",
      voices: [
        { title: "系统自动选角", voice: "auto" },
        { title: "女声旁白", voice: "narrator_female" },
        { title: "男声旁白", voice: "narrator_male" },
        { title: "年轻女声", voice: "young_female" },
        { title: "年轻男声", voice: "young_male" },
      ],
    },
  ],
};

function requireCredential(): {
  apiKey: string;
  baseUrl: string;
  qualityMode: string;
  policyVersion: string;
  productId: string;
  projectRef: string;
} {
  const apiKey = String(vendor.inputValues.apiKey || "").replace(/^Bearer\s+/i, "");
  const baseUrl = String(vendor.inputValues.baseUrl || "").replace(/\/+$/, "");
  const qualityMode = String(vendor.inputValues.qualityMode || "standard");
  const policyVersion = String(vendor.inputValues.policyVersion || "");
  const productId = String(vendor.inputValues.productId || "xiaoyu-drama");
  const projectRef = String(vendor.inputValues.projectRef || "");
  if (!apiKey) throw new Error("请先登录小鱼智算中心；充值或帮助请联系微信 echo169369");
  if (!baseUrl || baseUrl.includes("__XIAOYU_")) throw new Error("小鱼智算中心地址未正确写入安装包");
  if (!["quality", "standard", "economy"].includes(qualityMode)) throw new Error("无效的质量模式");
  if (!policyVersion) throw new Error("当前项目尚未锁定生产策略版本，请重新进入项目或选择质量模式");
  return { apiKey, baseUrl, qualityMode, policyVersion, productId, projectRef };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function idempotencyKey(capability: string, input: unknown, policyVersion: string, projectRef: string): string {
  const bucket = Math.floor(Date.now() / 600_000);
  return `xiaoyu_${capability}_${bucket}_${fnv1a(JSON.stringify({ input, policyVersion, projectRef }))}`;
}

function textIdempotencyKey(modelName: string, policyVersion: string, projectRef: string): string {
  return `xiaoyu_text_${Date.now()}_${fnv1a(`${modelName}:${policyVersion}:${projectRef}:${Math.random()}`)}`;
}

async function readJson(response: Response): Promise<any> {
  const raw = await response.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`小鱼智算中心返回无法解析的数据（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(String(data?.detail || data?.message || `HTTP ${response.status}`));
  if (typeof data?.code === "number" && data.code !== 200) throw new Error(String(data?.message || "请求失败"));
  return data?.data ?? data;
}

async function submitMediaJob(capability: string, input: Record<string, any>): Promise<string> {
  const { apiKey, baseUrl, qualityMode, policyVersion, productId, projectRef } = requireCredential();
  const createResponse = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Xiaoyu-Product": productId,
    },
    body: JSON.stringify({
      capability,
      quality_mode: qualityMode,
      policy_version: policyVersion,
      idempotency_key: idempotencyKey(capability, input, policyVersion, projectRef),
      project_ref: projectRef || undefined,
      stage_ref: capability,
      input,
    }),
  });
  const created = await readJson(createResponse);
  const jobId = String(created?.id || "");
  if (!jobId) throw new Error("小鱼智算中心未返回任务编号");
  logger(`[小鱼智算中心] ${capability} 任务已提交：${jobId}`);

  const result = await pollTask(
    async () => {
      const statusResponse = await fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-Xiaoyu-Product": productId },
      });
      const job = await readJson(statusResponse);
      switch (job.status) {
        case "completed": {
          const resultUrl = String(job?.result?.url || "");
          if (!resultUrl) return { completed: true, error: "任务完成但缺少结果文件" };
          return { completed: true, data: resultUrl };
        }
        case "failed":
        case "cancelled":
          return { completed: true, error: String(job.error || "生成失败，已自动退款") };
        default:
          return { completed: false };
      }
    },
    3000,
    60 * 60 * 1000,
  );
  if (result.error) throw new Error(result.error);
  if (!result.data) throw new Error("生成任务没有返回结果");
  return result.data;
}

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  const { apiKey, baseUrl, qualityMode, policyVersion, productId, projectRef } = requireCredential();
  return createOpenAI({
    baseURL: `${baseUrl}/v1`,
    apiKey,
    headers: {
      "X-Xiaoyu-Product": productId,
      "X-Xiaoyu-Quality-Mode": qualityMode,
      "X-Xiaoyu-Policy-Version": policyVersion,
      "X-Xiaoyu-Project-Ref": projectRef,
      "X-Xiaoyu-Stage-Ref": model.modelName,
      "X-Idempotency-Key": textIdempotencyKey(model.modelName, policyVersion, projectRef),
    },
  }).chat(model.modelName);
};

const imageRequest = async (config: ImageConfig, _model: ImageModel): Promise<string> => {
  const resultUrl = await submitMediaJob("image.generate", {
    prompt: config.prompt,
    size: config.size,
    aspect_ratio: config.aspectRatio,
    reference_images: (config.referenceList || []).map((item) => item.base64),
  });
  return await urlToBase64(resultUrl);
};

const videoRequest = async (config: VideoConfig, _model: VideoModel): Promise<string> => {
  const references = (config.referenceList || []).map((item) => ({ type: item.type, data: item.base64 }));
  const resultUrl = await submitMediaJob("video.generate", {
    prompt: config.prompt,
    duration: config.duration,
    resolution: config.resolution,
    aspect_ratio: config.aspectRatio,
    audio: config.audio,
    mode: config.mode,
    references,
  });
  return await urlToBase64(resultUrl);
};

const ttsRequest = async (config: TTSConfig, _model: TTSModel): Promise<string> => {
  const resultUrl = await submitMediaJob("audio.speech", {
    text: config.text,
    voice: config.voice,
    speech_rate: config.speechRate,
    pitch_rate: config.pitchRate,
    volume: config.volume,
    reference_audio: (config.referenceList || []).map((item) => item.base64),
  });
  return await urlToBase64(resultUrl);
};

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
