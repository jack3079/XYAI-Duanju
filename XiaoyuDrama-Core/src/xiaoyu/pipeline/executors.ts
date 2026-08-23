import u from "@/utils";
import { ensureMediaRuntime } from "../commercial/ffmpegRuntime";
import { assertXiaoyuProductionResources } from "../maintenance/resourceGuard";
import type { PipelineExecutionContext } from "./context";
import { executeAssetImagesStage, executeAssetPromptsStage, executeAssetsStage } from "./assetStages";
import { executeDeliveryManifestStage, executeVideoTracksStage, executeVideosStage } from "./mediaStages";
import { executeEpisodeMastersStage, executeQualityReportStage, executeSubtitlesStage, executeVoiceTracksStage } from "./commercialStages";
import { executeScriptsStage } from "./scriptStage";
import { executeStoryboardImagesStage, executeStoryboardsStage } from "./storyboardStages";
import type { PipelineNodeKey } from "./types";
import { getCustomAgentConfigurationState, getModelRouteAvailability, getProjectProviderMode } from "../modelRouting";

export type PipelineExecutor = (context: PipelineExecutionContext) => Promise<Record<string, unknown>>;

async function executePreflightStage(ctx: PipelineExecutionContext): Promise<Record<string, unknown>> {
  const db = u.db as any;
  const providerMode = getProjectProviderMode(ctx.project);
  if (providerMode === "unconfigured") throw new Error("项目尚未配置图片/视频模型");

  const sourceCount = ctx.project.projectType === "novel"
    ? Number((await db("o_novel").where({ projectId: ctx.run.projectId }).count({ count: "id" }).first())?.count || 0)
    : Number((await db("o_script").where({ projectId: ctx.run.projectId }).count({ count: "id" }).first())?.count || 0);
  if (!sourceCount && !String(ctx.project.intro || "").trim()) throw new Error("项目没有小说原文、剧本或故事简介，无法开始一键生产");
  if (!String(ctx.project.imageModel || "").trim() || !String(ctx.project.videoModel || "").trim()) throw new Error("请在项目中选择图片模型和视频模型");

  const imageRoute = await getModelRouteAvailability(ctx.project.imageModel);
  if (!imageRoute.ok) throw new Error(`图片模型不可用：${imageRoute.reason}；请编辑项目重新选择模型`);
  const videoRoute = await getModelRouteAvailability(ctx.project.videoModel);
  if (!videoRoute.ok) throw new Error(`视频模型不可用：${videoRoute.reason}；请编辑项目重新选择模型`);

  const agentState = await getCustomAgentConfigurationState();
  if (agentState.missing.length) throw new Error(`还缺少 Agent 模型：${agentState.missing.join("、")}；请在 设置 → Agent 配置 中选择文本模型`);
  if (agentState.invalid.length) throw new Error(`Agent 模型配置不可用：${agentState.invalid.join("；")}；请在 设置 → Agent 配置 中重新选择`);

  const localResources = await assertXiaoyuProductionResources({ qualityMode: ctx.run.qualityMode, episodeCount: ctx.options.episodeCount, shotsPerEpisode: ctx.options.shotsPerEpisode, enableVoice: ctx.options.enableVoice, enableMusic: ctx.options.enableMusic });
  const { ffmpeg, ffprobe } = await ensureMediaRuntime();
  const output = {
    providerMode,
    policyVersion: ctx.run.policyVersion,
    qualityMode: ctx.run.qualityMode,
    sourceCount,
    localResources,
    mediaRuntime: { ffmpeg, ffprobe },
    commercialOutput: { voice: ctx.options.enableVoice, subtitles: ctx.options.enableSubtitles, music: ctx.options.enableMusic, keepClipAudio: ctx.options.keepClipAudio },
    models: { image: String(ctx.project.imageModel), video: String(ctx.project.videoModel) },
  };
  await ctx.saveCheckpoint(output, output);
  await ctx.log("生产前检查通过；文本 Agent、图片模型、视频模型均按用户配置 Provider 运行", output);
  return output;
}

export const PIPELINE_EXECUTORS: Record<PipelineNodeKey, PipelineExecutor> = {
  preflight: executePreflightStage,
  scripts: executeScriptsStage,
  assets: executeAssetsStage,
  asset_prompts: executeAssetPromptsStage,
  asset_images: executeAssetImagesStage,
  storyboards: executeStoryboardsStage,
  storyboard_images: executeStoryboardImagesStage,
  video_tracks: executeVideoTracksStage,
  videos: executeVideosStage,
  voice_tracks: executeVoiceTracksStage,
  subtitles: executeSubtitlesStage,
  episode_masters: executeEpisodeMastersStage,
  quality_report: executeQualityReportStage,
  delivery_manifest: executeDeliveryManifestStage,
};
