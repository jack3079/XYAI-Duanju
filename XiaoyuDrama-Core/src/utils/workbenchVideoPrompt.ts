import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import u from "@/utils";
import { getModelRouteAvailability } from "@/xiaoyu/modelRouting";
import {
  buildSeedance2AssetReferenceContext,
  formatLegacyVideoPromptAssetList,
  isSeedance2Model,
  type VideoPromptAssetReference,
} from "@/lib/videoPromptReferences";

export interface VideoPromptInfoRef {
  id: number;
  sources: "assets" | "storyboard";
  fileType?: "image" | "video" | "audio";
}

export interface VideoPromptTaskInput {
  projectId: number;
  trackId: number;
  info: VideoPromptInfoRef[];
  model: string;
  mode: string | string[];
}

interface PromptTemplateContext {
  projectId: number;
  vendorId: string;
  modelId: string;
  template: string;
  visualManual: string;
}

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function splitModelRef(model: string): [string, string] {
  const match = String(model || "").trim().match(/^([^:]+):(.+)$/);
  if (!match) throw httpError(400, "视频模型格式无效，应为 provider:model");
  return [match[1], match[2]];
}

function isPathWithin(root: string, target: string): boolean {
  const relation = path.relative(path.resolve(root), path.resolve(target));
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

async function readTemplateFile(root: string, relativePath: string): Promise<string> {
  const target = path.resolve(root, String(relativePath || ""));
  if (!isPathWithin(root, target)) throw httpError(400, "视频提示词模板路径越界");
  return fs.readFile(target, "utf-8");
}

function isMultiReferenceMode(mode: string | string[]): boolean {
  if (Array.isArray(mode)) return true;
  const value = String(mode || "").trim();
  if (!value.startsWith("[")) return false;
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
}

async function loadPromptTemplate(vendorId: string, modelId: string, mode: string | string[]): Promise<string> {
  const modelPromptRoot = u.getPath(["modelPrompt"]);
  const configured = await u.db("o_modelPrompt").where({ vendorId, model: modelId }).first();
  if (configured?.path) {
    try {
      const content = await readTemplateFile(modelPromptRoot, configured.path);
      if (content.trim()) return content;
    } catch (error) {
      console.warn(`[视频提示词] 自定义模型模板读取失败 ${configured.path}:`, u.error(error).message);
    }
  }

  const modelLower = modelId.toLowerCase();
  let fileName = "";
  if (modelLower.includes("wan") && modelLower.includes("2.6")) {
    fileName = "wan2.6Single-imageFirstFrameMode.md";
  } else if (isSeedance2Model(modelId)) {
    fileName = "seedance2Multi-parameterMode.md";
  } else if (["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(String(mode))) {
    fileName = "universalFirstAndLastFrameMode.md";
  } else if (isMultiReferenceMode(mode)) {
    fileName = "universalMulti-parameterMode.md";
  }

  if (fileName) {
    try {
      const content = await readTemplateFile(path.join(modelPromptRoot, "video"), fileName);
      if (content.trim()) return content;
    } catch (error) {
      console.warn(`[视频提示词] 内置模型模板读取失败 ${fileName}:`, u.error(error).message);
    }
  }

  const fallback = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
  const text = String(fallback?.useData || fallback?.data || "").trim();
  if (!text) throw httpError(500, "系统缺少视频提示词模板，请在设置中配置 videoPromptGeneration");
  return text;
}

export async function prepareVideoPromptContext(projectId: number, model: string, mode: string | string[]): Promise<PromptTemplateContext> {
  const project = await u.db("o_project").where({ id: projectId }).first("id", "artStyle");
  if (!project) throw httpError(404, "项目不存在");
  const route = await getModelRouteAvailability(model, "video");
  if (!route.ok) throw httpError(400, `视频模型不可用：${route.reason}`);
  const [vendorId, modelId] = splitModelRef(model);
  const template = await loadPromptTemplate(vendorId, modelId, mode);
  const visualManual = String(u.getArtPrompt(project.artStyle || "无", "art_skills", "art_storyboard_video") || "");
  return { projectId, vendorId, modelId, template, visualManual };
}

export async function validateVideoPromptTask(input: VideoPromptTaskInput): Promise<{ scriptId: number }> {
  const track = await u.db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId }).first("id", "scriptId");
  if (!track) throw httpError(404, `视频轨道不存在或不属于当前项目：${input.trackId}`);
  const scriptId = Number(track.scriptId || 0);
  if (!Number.isSafeInteger(scriptId) || scriptId <= 0) throw httpError(409, `轨道 ${input.trackId} 未绑定有效剧集`);
  const script = await u.db("o_script").where({ id: scriptId, projectId: input.projectId }).first("id");
  if (!script) throw httpError(404, `轨道 ${input.trackId} 对应的剧集已不存在`);

  const seen = new Set<string>();
  for (const ref of input.info) {
    const key = `${ref.sources}:${ref.id}`;
    if (seen.has(key)) throw httpError(400, `提示词引用素材重复：${key}`);
    seen.add(key);
    if (ref.sources === "storyboard") {
      const row = await u.db("o_storyboard").where({ id: ref.id, projectId: input.projectId, scriptId }).first("id");
      if (!row) throw httpError(400, `分镜素材不存在或不属于当前剧集：${ref.id}`);
    } else {
      const row = await u.db("o_assets").where({ id: ref.id, projectId: input.projectId }).first("id");
      if (!row) throw httpError(400, `资产不存在或不属于当前项目：${ref.id}`);
    }
  }
  return { scriptId };
}

async function buildAssetAudioLinks(projectId: number, assets: VideoPromptAssetReference[]): Promise<Record<number, number>> {
  const roleIds = assets.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!roleIds.length) return {};
  const rows = await u.db("o_assetsRole2Audio")
    .join("o_assets", "o_assets.assetsId", "o_assetsRole2Audio.assetsAudioId")
    .whereIn("o_assetsRole2Audio.assetsRoleId", roleIds)
    .where("o_assets.projectId", projectId)
    .select("o_assetsRole2Audio.assetsRoleId", "o_assets.id as audioAssetId");
  const result: Record<number, number> = {};
  for (const row of rows) {
    const roleId = Number(row.assetsRoleId || 0);
    const audioId = Number(row.audioAssetId || 0);
    if (roleId && audioId) result[roleId] = audioId;
  }
  return result;
}

async function buildTrackPromptContent(input: VideoPromptTaskInput, scriptId: number, modelId: string): Promise<string> {
  const values = await Promise.all(input.info.map(async (ref) => {
    if (ref.sources === "storyboard") {
      const storyboard = await u.db("o_storyboard")
        .where({ id: ref.id, projectId: input.projectId, scriptId })
        .select("id", "videoDesc", "prompt", "track", "duration", "shouldGenerateImage")
        .first();
      if (!storyboard) throw httpError(400, `分镜素材已不存在：${ref.id}`);
      const associateAssetsIds = await u.db("o_assets2Storyboard")
        .where("storyboardId", ref.id)
        .orderBy("rowid")
        .pluck("assetId");
      return { ...storyboard, associateAssetsIds, _type: "storyboard" as const };
    }

    const asset = await u.db("o_assets")
      .leftJoin("o_image", "o_image.id", "o_assets.imageId")
      .where({ "o_assets.id": ref.id, "o_assets.projectId": input.projectId })
      .select("o_assets.id", "o_assets.type", "o_assets.name", "o_image.filePath", "o_image.type as storedFileType")
      .first();
    if (!asset) throw httpError(400, `资产已不存在：${ref.id}`);
    return { ...asset, mediaType: ref.fileType ?? asset.storedFileType, _type: "assets" as const };
  }));

  const assets: VideoPromptAssetReference[] = [];
  const storyboards: any[] = [];
  for (const item of values) {
    if (item._type === "assets") {
      assets.push({ id: Number(item.id), type: item.type, name: item.name, filePath: item.filePath, mediaType: item.mediaType });
    } else {
      storyboards.push(item);
    }
  }
  const audioLinks = await buildAssetAudioLinks(input.projectId, assets);
  const assetContext = isSeedance2Model(modelId)
    ? buildSeedance2AssetReferenceContext(assets, audioLinks)
    : `**资产信息**（角色、场景、道具、音频）:${formatLegacyVideoPromptAssetList(assets, audioLinks) || "无"}`;
  const storyboardContext = storyboards.map((item) => `<storyboardItem videoDesc=${JSON.stringify(item.videoDesc || "")} duration=${JSON.stringify(item.duration || 0)}></storyboardItem>`).join("\n");
  return `**模型名称**：${modelId}\n${assetContext}\n**分镜信息**：\n${storyboardContext || "无"}`;
}

export async function generateTrackVideoPrompt(input: VideoPromptTaskInput, context: PromptTemplateContext): Promise<string> {
  const { scriptId } = await validateVideoPromptTask(input);
  const affected = await u.db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId, scriptId }).update({ state: "生成中", reason: null });
  if (affected !== 1) throw httpError(409, `轨道 ${input.trackId} 已变化，请刷新后重试`);

  try {
    const content = await buildTrackPromptContent(input, scriptId, context.modelId);
    const { text } = await u.Ai.Text("universalAi").invoke({
      system: context.template,
      messages: [
        { role: "assistant", content: context.visualManual },
        { role: "user", content },
      ],
    });
    const prompt = String(text || "").trim();
    if (!prompt) throw new Error("文本 Agent 未返回视频提示词");
    await u.db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId, scriptId }).update({
      prompt,
      state: "已完成",
      reason: null,
    });
    return prompt;
  } catch (error) {
    const message = u.error(error).message;
    await u.db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId, scriptId }).update({
      state: "生成失败",
      reason: message,
    }).catch((dbError: unknown) => console.error("[视频提示词] 写入失败状态失败", u.error(dbError).message));
    throw error;
  }
}

export function launchBatchVideoPromptGeneration(
  inputs: VideoPromptTaskInput[],
  context: PromptTemplateContext,
  concurrentCount: number,
): void {
  const concurrency = Math.min(Math.max(Math.trunc(Number(concurrentCount) || 3), 1), 10);
  const limit = pLimit(concurrency);
  const tasks = inputs.map((input) => limit(async () => {
    try {
      await generateTrackVideoPrompt(input, context);
    } catch (error) {
      console.error(`[视频提示词] track=${input.trackId} 生成失败:`, u.error(error).message);
    }
  }));
  void Promise.all(tasks).catch((error) => console.error("[视频提示词] 批量后台任务异常", u.error(error).message));
}
