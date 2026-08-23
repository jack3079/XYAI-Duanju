import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { resolveVideoReferenceMediaType } from "@/lib/videoPromptReferences";

const router = express.Router();

type TrackState = "未生成" | "生成中" | "已完成" | "生成失败";

interface VideoItem {
  id: number;
  src: string;
  state: TrackState;
  errorReason?: string;
}

interface TrackMedia {
  src: string;
  id?: number;
  fileType: "image" | "video" | "audio";
  videoDesc?: string;
  sources?: "assets" | "storyboard";
  prompt?: string;
  index?: number | null;
}

interface TrackItem {
  id?: number;
  prompt: string;
  state: TrackState;
  reason?: string;
  duration?: number;
  selectVideoId?: number;
  medias: TrackMedia[];
  videoList: VideoItem[];
}

function parseProjectMode(raw: unknown): string | string[] {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!value.startsWith("[")) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : value;
  } catch {
    return value;
  }
}

function normalizeTrackState(value: unknown): TrackState {
  const state = String(value || "");
  if (state === "生成中") return "生成中";
  if (state === "生成失败") return "生成失败";
  if (state === "已完成" || state === "生成成功") return "已完成";
  return "未生成";
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
  }),
  async (req, res, next) => {
    try {
      const { projectId, scriptId } = req.body;
      const projectData = await u.db("o_project").where({ id: projectId }).select("id", "videoModel", "mode").first();
      if (!projectData) return res.status(404).send(error("项目不存在"));
      const script = await u.db("o_script").where({ id: scriptId, projectId }).first("id");
      if (!script) return res.status(404).send(error("剧集不存在或不属于当前项目"));

      // 即使项目尚未保存默认视频模型，也允许进入工作台后手工选择模型。
      const videoMode = parseProjectMode(projectData.mode);
      const isRef = Array.isArray(videoMode);
      const storyboardList = await u.db("o_storyboard").where({ scriptId, projectId }).orderBy("index", "asc");

      const storyboardTrackRecord: Record<number, TrackMedia[]> = {};
      for (const storyboard of storyboardList) {
        const trackId = Number(storyboard.trackId || 0);
        if (!Number.isSafeInteger(trackId) || trackId <= 0) continue;
        const src = storyboard.filePath ? await u.oss.getSmallImageUrl(storyboard.filePath) : "";
        if (!storyboardTrackRecord[trackId]) storyboardTrackRecord[trackId] = [];
        storyboardTrackRecord[trackId].push({
          src,
          fileType: "image",
          sources: "storyboard",
          ...(storyboard.videoDesc != null ? { prompt: storyboard.videoDesc } : {}),
          ...(storyboard.id != null ? { id: Number(storyboard.id) } : {}),
          index: storyboard.index,
        });
      }

      const otherDataMap: Record<number, TrackMedia[]> = {};
      const audioReferenceCount = (() => {
        if (!Array.isArray(videoMode)) return 0;
        const item = videoMode.find((value) => value.toLowerCase().startsWith("audioreference:"));
        if (!item) return 0;
        const count = Number.parseInt(item.split(":")[1], 10);
        return Number.isFinite(count) && count > 0 ? count : 0;
      })();

      const storyIds = storyboardList
        .map((item) => Number(item.id || 0))
        .filter((id) => Number.isSafeInteger(id) && id > 0);

      if (isRef && storyIds.length) {
        const assetDatas = await u.db("o_assets2Storyboard")
          .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
          .leftJoin("o_image", "o_image.id", "o_assets.imageId")
          .whereIn("o_assets2Storyboard.storyboardId", storyIds)
          .where("o_assets.projectId", projectId)
          .select("o_assets.*", "o_image.filePath", "o_image.type as storedFileType", "o_assets2Storyboard.storyboardId");

        const queryAudioIds = [...new Set(assetDatas
          .flatMap((item: any) => [Number(item.id || 0), Number(item.assetsId || 0)])
          .filter((id: number) => Number.isSafeInteger(id) && id > 0))];

        const audioRecord: Record<number, TrackMedia[]> = {};
        if (queryAudioIds.length) {
          const audioRows = await u.db("o_assetsRole2Audio")
            .leftJoin("o_assets", "o_assets.assetsId", "o_assetsRole2Audio.assetsAudioId")
            .leftJoin("o_image", "o_image.id", "o_assets.imageId")
            .whereIn("o_assetsRole2Audio.assetsRoleId", queryAudioIds)
            .where("o_assets.projectId", projectId)
            .select(
              "o_assets.id",
              "o_assets.name",
              "o_assetsRole2Audio.assetsRoleId",
              "o_assets.describe",
              "o_assets.type",
              "o_assets.prompt",
              "o_image.filePath",
            );
          for (const item of audioRows) {
            const roleId = Number(item.assetsRoleId || 0);
            if (!roleId) continue;
            if (!audioRecord[roleId]) audioRecord[roleId] = [];
            audioRecord[roleId].push({
              id: item.id == null ? undefined : Number(item.id),
              src: item.filePath ? await u.oss.getFileUrl(item.filePath) : "",
              fileType: "audio",
              sources: "assets",
              prompt: item.prompt || item.describe || "",
            });
          }
        }

        for (const item of assetDatas) {
          const storyboardId = Number(item.storyboardId || 0);
          if (!storyboardId) continue;
          if (!otherDataMap[storyboardId]) otherDataMap[storyboardId] = [];
          otherDataMap[storyboardId].push({
            id: item.id == null ? undefined : Number(item.id),
            src: item.filePath ? await u.oss.getSmallImageUrl(item.filePath) : "",
            fileType: resolveVideoReferenceMediaType(item.storedFileType, item.type, item.filePath),
            sources: "assets",
          });
          const id = Number(item.id || 0);
          const assetsId = Number(item.assetsId || 0);
          if (id && audioRecord[id]) otherDataMap[storyboardId].push(...audioRecord[id]);
          if (assetsId && audioRecord[assetsId]) otherDataMap[storyboardId].push(...audioRecord[assetsId]);
        }
      }

      const trackData = await u.db("o_videoTrack").where({ projectId, scriptId });
      const trackIds = [...new Set(trackData
        .map((item) => Number(item.id || 0))
        .filter((id) => Number.isSafeInteger(id) && id > 0))];
      const videoList = trackIds.length
        ? await u.db("o_video").where({ projectId, scriptId }).whereIn("videoTrackId", trackIds)
        : [];

      const trackList: TrackItem[] = [];
      for (const trackId of trackIds) {
        const item = trackData.find((track) => Number(track.id) === trackId);
        const storyboardMedias = storyboardTrackRecord[trackId] ?? [];
        const assetMedias = storyboardMedias.flatMap((storyboard) => storyboard.id ? otherDataMap[storyboard.id] ?? [] : []);
        const seenAssetIds = new Set<string>();
        const uniqueAssets = assetMedias.filter((asset) => {
          const key = `${asset.fileType}:${asset.id ?? asset.src}`;
          if (seenAssetIds.has(key)) return false;
          seenAssetIds.add(key);
          return true;
        });

        let audioSeen = 0;
        const filteredAssets = uniqueAssets.filter((asset) => {
          if (asset.fileType !== "audio" || audioReferenceCount === 0) return true;
          audioSeen += 1;
          return audioSeen <= audioReferenceCount;
        });
        const withMedia = filteredAssets.filter((asset) => asset.src);
        const withoutMedia = filteredAssets.filter((asset) => !asset.src);

        const videos = videoList.filter((video) => Number(video.videoTrackId) === trackId);
        trackList.push({
          id: trackId,
          duration: Number(item?.duration || 0),
          prompt: item?.prompt || "",
          state: normalizeTrackState(item?.state),
          reason: item?.reason ?? "",
          selectVideoId: item?.videoId == null ? undefined : Number(item.videoId),
          medias: [...withMedia, ...storyboardMedias, ...withoutMedia],
          videoList: await Promise.all(videos.map(async (video) => {
            const state = normalizeTrackState(video.state);
            const hasFile = state === "已完成" && video.filePath ? await u.oss.fileExists(video.filePath) : false;
            return {
              id: Number(video.id),
              src: hasFile ? await u.oss.getFileUrl(video.filePath!) : "",
              state: state === "已完成" && !hasFile ? "生成失败" : state,
              errorReason: state === "已完成" && !hasFile ? "视频文件已丢失，请重新生成" : video.errorReason ?? "",
            };
          })),
        });
      }

      res.status(200).send(success({
        storyboardList: await Promise.all(storyboardList.map(async (storyboard) => ({
          ...storyboard,
          src: storyboard.filePath ? await u.oss.getSmallImageUrl(storyboard.filePath) : "",
        }))),
        trackList,
        projectVideoModel: projectData.videoModel || "",
      }));
    } catch (exception) {
      next(exception);
    }
  },
);
