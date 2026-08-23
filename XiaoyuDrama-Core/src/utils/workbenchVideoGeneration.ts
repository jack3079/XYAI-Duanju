import { v4 as uuidv4 } from "uuid";
import pLimit from "p-limit";
import u from "@/utils";
import type { ReferenceList } from "@/utils/ai";
import { getModelRouteAvailability } from "@/xiaoyu/modelRouting";
import { resolveVideoReferenceMediaType } from "@/lib/videoPromptReferences";

type MediaType = "image" | "video" | "audio";
type SourceType = "assets" | "storyboard";

export interface VideoUploadRef {
  id: number;
  sources: SourceType;
  fileType?: MediaType;
}

export interface VideoGenerationInput {
  projectId: number;
  scriptId: number;
  trackId: number;
  prompt: string;
  model: string;
  mode: unknown;
  resolution: string;
  duration: number;
  audio?: boolean;
  uploadData: VideoUploadRef[];
}

export interface PreparedVideoGeneration extends VideoGenerationInput {
  aspectRatio: "16:9" | "9:16";
  normalizedMode: any[];
}

export interface CreatedVideoGeneration extends PreparedVideoGeneration {
  videoId: number;
  videoPath: string;
}

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function generationConcurrency(): number {
  const value = Number(process.env.XIAOYU_VIDEO_GENERATION_CONCURRENCY || 3);
  if (!Number.isFinite(value)) return 3;
  return Math.min(Math.max(Math.trunc(value), 1), 10);
}

const generationLimit = pLimit(generationConcurrency());

function parseMode(raw: unknown): string | string[] {
  if (Array.isArray(raw)) {
    if (!raw.length || raw.some((item) => typeof item !== "string" || !item.trim())) throw httpError(400, "视频生成模式无效");
    return raw.map((item) => item.trim());
  }
  const value = String(raw || "").trim();
  if (!value) throw httpError(400, "请选择视频生成模式");
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || !parsed.length || parsed.some((item) => typeof item !== "string" || !item.trim())) throw new Error();
      return parsed.map((item) => item.trim());
    } catch {
      throw httpError(400, "视频生成模式 JSON 无效");
    }
  }
  return value;
}

function sameMode(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
  return !Array.isArray(left) && !Array.isArray(right) && String(left) === String(right);
}

function providerMode(parsed: string | string[]): any[] {
  return Array.isArray(parsed) ? parsed : [parsed];
}

function supportedDurationResolution(model: any, duration: number, resolution: string): boolean {
  const maps = Array.isArray(model?.durationResolutionMap) ? model.durationResolutionMap : [];
  if (!maps.length) return true;
  return maps.some((item: any) =>
    Array.isArray(item?.duration)
    && item.duration.map(Number).includes(Number(duration))
    && Array.isArray(item?.resolution)
    && item.resolution.map(String).includes(String(resolution)),
  );
}

function validateReferenceCount(mode: string | string[], refs: ReferenceList[]): void {
  const counts = {
    image: refs.filter((item) => item.type === "image").length,
    video: refs.filter((item) => item.type === "video").length,
    audio: refs.filter((item) => item.type === "audio").length,
  };

  if (mode === "singleImage" && counts.image < 1) throw httpError(400, "单图模式至少需要 1 张图片");
  if (mode === "startEndRequired" && counts.image < 2) throw httpError(400, "首尾帧模式需要 2 张图片");
  if ((mode === "endFrameOptional" || mode === "startFrameOptional") && counts.image < 1) throw httpError(400, "当前帧模式至少需要 1 张图片");
  if (mode === "imageReference" && counts.image < 1) throw httpError(400, "图片参考模式至少需要 1 张图片");
  if (mode === "videoReference" && counts.video < 1) throw httpError(400, "视频参考模式至少需要 1 个视频");
  if (mode === "audioReference" && counts.audio < 1) throw httpError(400, "音频参考模式至少需要 1 个音频");

  if (Array.isArray(mode)) {
    for (const item of mode) {
      const match = item.match(/^(imageReference|videoReference|audioReference):(\d+)$/);
      if (!match) continue;
      const expected = Number(match[2]);
      const key = match[1] === "imageReference" ? "image" : match[1] === "videoReference" ? "video" : "audio";
      if (counts[key] < expected) throw httpError(400, `${match[1]} 需要 ${expected} 个素材，当前只有 ${counts[key]} 个`);
    }
  }
}

async function resolveUploadPath(input: PreparedVideoGeneration, item: VideoUploadRef): Promise<{ path: string; type: MediaType }> {
  if (item.sources === "storyboard") {
    const row = await u.db("o_storyboard")
      .where({ id: item.id, projectId: input.projectId, scriptId: input.scriptId })
      .first("filePath");
    if (!row?.filePath) throw httpError(400, `分镜素材不存在或没有图片：${item.id}`);
    return { path: String(row.filePath), type: "image" };
  }

  const row = await u.db("o_assets")
    .where({ "o_assets.id": item.id, "o_assets.projectId": input.projectId })
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .select("o_image.filePath", "o_image.type")
    .first();
  if (!row?.filePath) throw httpError(400, `资产素材不存在或没有媒体文件：${item.id}`);
  return {
    path: String(row.filePath),
    type: resolveVideoReferenceMediaType(item.fileType, row.type, row.filePath),
  };
}

async function loadReferences(input: PreparedVideoGeneration): Promise<ReferenceList[]> {
  const resolved = await Promise.all(input.uploadData.map((item) => resolveUploadPath(input, item)));
  const refs: ReferenceList[] = [];
  for (const item of resolved) {
    if (!(await u.oss.fileExists(item.path))) throw httpError(400, `引用素材文件已丢失：${item.path}`);
    refs.push({ type: item.type, base64: await u.oss.getImageBase64(item.path) } as ReferenceList);
  }
  validateReferenceCount(parseMode(input.mode), refs);
  return refs;
}

export async function prepareVideoGeneration(input: VideoGenerationInput): Promise<PreparedVideoGeneration> {
  const project = await u.db("o_project").where({ id: input.projectId }).first("id", "videoRatio");
  if (!project) throw httpError(404, "项目不存在");
  const script = await u.db("o_script").where({ id: input.scriptId, projectId: input.projectId }).first("id");
  if (!script) throw httpError(404, "剧集不存在或不属于当前项目");
  const track = await u.db("o_videoTrack").where({ id: input.trackId, projectId: input.projectId, scriptId: input.scriptId }).first("id");
  if (!track) throw httpError(404, "视频轨道不存在或不属于当前剧集");

  const route = await getModelRouteAvailability(input.model, "video");
  if (!route.ok) throw httpError(400, `视频模型不可用：${route.reason}`);
  const models = await u.vendor.getModelList(route.vendorId);
  const model = models.find((item: any) => String(item?.modelName || "") === route.modelId);
  if (!model) throw httpError(400, `视频模型不存在：${input.model}`);

  const parsedMode = parseMode(input.mode);
  const allowedModes = Array.isArray(model?.mode) ? model.mode : [];
  if (allowedModes.length && !allowedModes.some((item: unknown) => sameMode(item, parsedMode))) {
    throw httpError(400, `当前视频模型不支持生成模式：${Array.isArray(parsedMode) ? JSON.stringify(parsedMode) : parsedMode}`);
  }
  if (!Number.isFinite(input.duration) || input.duration <= 0) throw httpError(400, "视频时长必须大于 0");
  if (!String(input.resolution || "").trim()) throw httpError(400, "请选择视频分辨率");
  if (!supportedDurationResolution(model, input.duration, input.resolution)) {
    throw httpError(400, `模型 ${route.modelId} 不支持 ${input.duration}s / ${input.resolution}`);
  }
  if (input.audio === true && model.audio === false) throw httpError(400, `模型 ${route.modelId} 不支持生成音频`);

  const duplicateRefs = new Set<string>();
  for (const ref of input.uploadData) {
    const key = `${ref.sources}:${ref.id}`;
    if (duplicateRefs.has(key)) throw httpError(400, `引用素材重复：${key}`);
    duplicateRefs.add(key);
  }

  return {
    ...input,
    prompt: String(input.prompt || "").trim(),
    model: String(input.model || "").trim(),
    resolution: String(input.resolution || "").trim(),
    aspectRatio: project.videoRatio === "9:16" ? "9:16" : "16:9",
    normalizedMode: providerMode(parsedMode),
  };
}

export async function createVideoGenerationRecords(inputs: PreparedVideoGeneration[]): Promise<CreatedVideoGeneration[]> {
  if (!inputs.length) return [];
  const trackIds = inputs.map((item) => item.trackId);
  if (new Set(trackIds).size !== trackIds.length) throw httpError(400, "批量生成包含重复的视频轨道");

  return u.db.transaction(async (trx: any) => {
    const created: CreatedVideoGeneration[] = [];
    for (const input of inputs) {
      const running = await trx("o_video").where({ videoTrackId: input.trackId, state: "生成中" }).first("id");
      if (running) throw httpError(409, `轨道 ${input.trackId} 已有视频正在生成，请等待完成后再试`);

      const videoPath = `${input.projectId}/video/${uuidv4()}.mp4`;
      const [videoId] = await trx("o_video").insert({
        filePath: videoPath,
        time: Date.now(),
        state: "生成中",
        scriptId: input.scriptId,
        projectId: input.projectId,
        videoTrackId: input.trackId,
        errorReason: null,
      });
      const affected = await trx("o_videoTrack")
        .where({ id: input.trackId, projectId: input.projectId, scriptId: input.scriptId })
        .update({ state: "生成中", reason: null });
      if (affected !== 1) throw httpError(409, `轨道 ${input.trackId} 已变化，请刷新后重试`);
      created.push({ ...input, videoId, videoPath });
    }
    return created;
  });
}

async function executeVideoGeneration(task: CreatedVideoGeneration): Promise<void> {
  try {
    const refs = await loadReferences(task);
    validateReferenceCount(parseMode(task.mode), refs);
    const aiVideo = u.Ai.Video(task.model as `${string}:${string}`);
    await aiVideo.run(
      {
        prompt: task.prompt,
        referenceList: refs,
        mode: task.normalizedMode as any,
        duration: task.duration,
        aspectRatio: task.aspectRatio,
        resolution: task.resolution,
        audio: Boolean(task.audio),
      },
      {
        projectId: task.projectId,
        taskClass: "视频生成",
        describe: "根据提示词生成视频",
        relatedObjects: JSON.stringify({
          projectId: task.projectId,
          videoId: task.videoId,
          scriptId: task.scriptId,
          trackId: task.trackId,
          type: "视频",
        }),
      },
    );
    await aiVideo.save(task.videoPath);

    await u.db.transaction(async (trx: any) => {
      const videoAffected = await trx("o_video").where({ id: task.videoId, state: "生成中" }).update({ state: "生成成功", errorReason: null });
      if (videoAffected !== 1) throw new Error(`视频记录已变化：${task.videoId}`);
      await trx("o_videoTrack").where({ id: task.trackId }).update({ state: "已完成", reason: null });
    });
  } catch (exception) {
    const message = u.error(exception).message;
    console.error(`[视频生成失败] video=${task.videoId} track=${task.trackId}: ${message}`);
    await u.db.transaction(async (trx: any) => {
      await trx("o_video").where({ id: task.videoId }).update({ state: "生成失败", errorReason: message });
      await trx("o_videoTrack").where({ id: task.trackId }).update({ state: "生成失败", reason: message });
    }).catch((error: unknown) => console.error("[视频生成] 写入失败状态失败", u.error(error).message));
  }
}

export function launchVideoGeneration(task: CreatedVideoGeneration): void {
  void generationLimit(() => executeVideoGeneration(task)).catch((error) => {
    console.error("[视频生成] 后台任务异常", u.error(error).message);
  });
}
