import u from "@/utils";
import db from "@/utils/db";
import type { PipelineNodeKey, PipelineNodeStatus, PipelineOptions } from "./types";
import {
  PIPELINE_NODES,
  assertNodeTransition,
  assertRunTransition,
  calculatePipelineProgress,
  defaultPipelineOptions,
  downstreamNodeKeys,
  getNodeDefinition,
} from "./stateMachine";

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value ? JSON.parse(String(value)) as T : fallback;
  } catch {
    return fallback;
  }
}

function rememberFile(files: Set<string>, value: unknown): void {
  const filePath = String(value || "").trim();
  if (filePath) files.add(filePath);
}

async function deleteFileBestEffort(filePath: string): Promise<void> {
  try {
    if (await u.oss.fileExists(filePath)) await u.oss.deleteFile(filePath);
  } catch (exception) {
    console.warn(`[一键生产重做] 清理文件失败 ${filePath}:`, u.error(exception).message);
  }
}

function rerunOptions(current: PipelineOptions, nodeKey: PipelineNodeKey): PipelineOptions {
  const next = { ...current };
  const order = getNodeDefinition(nodeKey).order;
  if (order <= getNodeDefinition("scripts").order) next.overwriteScripts = true;
  if (order <= getNodeDefinition("assets").order) next.overwriteAssets = true;
  if (order <= getNodeDefinition("storyboards").order) next.overwriteStoryboards = true;
  if (order <= getNodeDefinition("videos").order) next.overwriteMedia = true;
  return next;
}

async function cleanupDownstreamArtifacts(
  trx: any,
  runId: string,
  nodeKeys: PipelineNodeKey[],
): Promise<string[]> {
  const activeRemote = await trx("o_xiaoyuRemoteJob")
    .where({ runId })
    .whereIn("nodeKey", nodeKeys)
    .whereNotIn("status", ["completed", "failed", "cancelled"])
    .first("idempotencyKey", "remoteJobId", "status");
  if (activeRemote) {
    throw new Error(
      `仍有远程任务未结算（${activeRemote.remoteJobId || activeRemote.idempotencyKey} / ${activeRemote.status}），请等待结算或取消后再重做`,
    );
  }

  const artifacts = await trx("o_xiaoyuPipelineArtifact")
    .where({ runId })
    .whereIn("nodeKey", nodeKeys);
  const order = new Map(PIPELINE_NODES.map((node) => [node.key, node.order]));
  artifacts.sort((left: any, right: any) =>
    Number(order.get(right.nodeKey) || 0) - Number(order.get(left.nodeKey) || 0)
    || Number(right.id || 0) - Number(left.id || 0));

  const files = new Set<string>();
  for (const artifact of artifacts) {
    const artifactId = artifact.artifactId == null ? null : Number(artifact.artifactId);
    switch (String(artifact.artifactType || "")) {
      case "delivery_manifest":
      case "ffmpeg_concat_list":
      case "delivery_summary":
      case "voice_clip":
      case "subtitle_srt":
      case "subtitle_ass":
      case "quality_report":
      case "music_track":
        rememberFile(files, artifact.filePath);
        break;

      case "episode_master": {
        rememberFile(files, artifact.filePath);
        const metadata = parseJson<Record<string, unknown>>(artifact.metadata, {});
        if (metadata.scriptId) {
          const rows = await trx("o_xiaoyuEpisodeMaster")
            .where({ runId, scriptId: Number(metadata.scriptId) })
            .select("filePath", "reportPath");
          for (const row of rows) {
            rememberFile(files, row.filePath);
            rememberFile(files, row.reportPath);
          }
          await trx("o_xiaoyuEpisodeMaster").where({ runId, scriptId: Number(metadata.scriptId) }).delete();
        } else if (artifactId) {
          const row = await trx("o_xiaoyuEpisodeMaster").where({ id: artifactId, runId }).first("filePath", "reportPath");
          rememberFile(files, row?.filePath);
          rememberFile(files, row?.reportPath);
          await trx("o_xiaoyuEpisodeMaster").where({ id: artifactId, runId }).delete();
        }
        break;
      }

      case "video": {
        const row = artifactId ? await trx("o_video").where({ id: artifactId }).first() : null;
        rememberFile(files, row?.filePath || artifact.filePath);
        if (row?.videoTrackId) {
          await trx("o_videoTrack")
            .where({ id: row.videoTrackId })
            .andWhere((builder: any) => builder.where("selectVideoId", row.id).orWhere("videoId", row.id))
            .update({ selectVideoId: null, videoId: null, state: "未生成", reason: null });
        }
        if (artifactId) await trx("o_video").where({ id: artifactId }).delete();
        break;
      }

      case "video_track": {
        if (!artifactId) break;
        const videos = await trx("o_video").where({ videoTrackId: artifactId }).select("filePath");
        for (const video of videos) rememberFile(files, video.filePath);
        await trx("o_video").where({ videoTrackId: artifactId }).delete();
        await trx("o_storyboard").where({ trackId: artifactId }).update({ trackId: null, track: null });
        await trx("o_videoTrack").where({ id: artifactId }).delete();
        break;
      }

      case "storyboard_image": {
        rememberFile(files, artifact.filePath);
        if (artifactId) {
          const storyboard = await trx("o_storyboard").where({ id: artifactId }).first("filePath");
          rememberFile(files, storyboard?.filePath);
          await trx("o_storyboard").where({ id: artifactId }).update({ filePath: null, state: "未生成", reason: null });
        }
        break;
      }

      case "storyboard": {
        if (!artifactId) break;
        const storyboard = await trx("o_storyboard").where({ id: artifactId }).first("filePath");
        rememberFile(files, storyboard?.filePath || artifact.filePath);
        await trx("o_assets2Storyboard").where({ storyboardId: artifactId }).delete();
        await trx("o_storyboard").where({ id: artifactId }).delete();
        break;
      }

      case "asset_image": {
        const image = artifactId ? await trx("o_image").where({ id: artifactId }).first() : null;
        rememberFile(files, image?.filePath || artifact.filePath);
        if (image?.assetsId) {
          await trx("o_assets")
            .where({ id: image.assetsId, imageId: image.id })
            .update({ imageId: null, promptState: "已完成", promptErrorReason: null });
        }
        if (artifactId) await trx("o_image").where({ id: artifactId }).delete();
        break;
      }

      case "asset": {
        if (!artifactId) break;
        const asset = await trx("o_assets").where({ id: artifactId }).first("imageId");
        if (asset?.imageId) {
          const image = await trx("o_image").where({ id: asset.imageId }).first("filePath");
          rememberFile(files, image?.filePath);
          await trx("o_image").where({ id: asset.imageId }).delete();
        }
        await trx("o_scriptAssets").where({ assetId: artifactId }).delete();
        await trx("o_assets2Storyboard").where({ assetId: artifactId }).delete();
        await trx("o_assetsRole2Audio").where("assetsRoleId", artifactId).orWhere("assetsAudioId", artifactId).delete();
        await trx("o_assets").where({ id: artifactId }).delete();
        break;
      }

      case "script":
        if (artifactId) {
          await trx("o_scriptAssets").where({ scriptId: artifactId }).delete();
          await trx("o_script").where({ id: artifactId }).delete();
        }
        break;

      default:
        rememberFile(files, artifact.filePath);
        break;
    }
  }

  if (artifacts.length) {
    await trx("o_xiaoyuPipelineArtifact").where({ runId }).whereIn("nodeKey", nodeKeys).delete();
  }
  // revision 变化后旧远程任务不能留给恢复器再次结算。
  await trx("o_xiaoyuRemoteJob").where({ runId }).whereIn("nodeKey", nodeKeys).delete();
  return [...files];
}

export async function safeResetRunFromNode(runId: string, nodeKey: PipelineNodeKey): Promise<void> {
  const nodeKeys = downstreamNodeKeys(nodeKey);
  let files: string[] = [];

  await db.transaction(async (trx: any) => {
    const run = await trx("o_xiaoyuPipelineRun").where({ id: runId }).first();
    if (!run) throw new Error("流水线不存在");
    if (["running", "queued", "pause_requested", "cancel_requested"].includes(run.status)) {
      throw new Error("流水线仍在执行或正在变更状态，不能局部重做");
    }

    const rows = await trx("o_xiaoyuPipelineNode").where({ runId }).whereIn("key", nodeKeys);
    if (rows.length !== nodeKeys.length) throw new Error("流水线节点数据不完整，不能局部重做");
    const allowed = new Set<PipelineNodeStatus>(["pending", "completed", "skipped", "failed", "cancelled", "paused"]);
    for (const row of rows) {
      if (!allowed.has(row.status)) throw new Error(`节点 ${row.key} 正在执行，不能从这里重做`);
      if (row.status !== "pending") assertNodeTransition(row.status, "pending");
    }
    if (run.status !== "queued") assertRunTransition(run.status, "queued");

    files = await cleanupDownstreamArtifacts(trx, runId, nodeKeys);
    const now = Date.now();
    const revisions: Record<string, number> = {};
    for (const row of rows) {
      const revision = Number(row.revision || 0) + 1;
      revisions[String(row.key)] = revision;
      const affected = await trx("o_xiaoyuPipelineNode").where({ id: row.id, runId }).update({
        status: "pending",
        attempt: 0,
        revision,
        nextRunAt: 0,
        checkpoint: "{}",
        output: "{}",
        errorReason: null,
        startedAt: null,
        finishedAt: null,
        updatedAt: now,
      });
      if (affected !== 1) throw new Error(`流水线节点已变化：${row.key}`);
    }

    const options = rerunOptions(parseJson<PipelineOptions>(run.options, defaultPipelineOptions()), nodeKey);
    const allNodes = await trx("o_xiaoyuPipelineNode").where({ runId }).select("key", "status");
    const statusByKey: Record<string, PipelineNodeStatus> = {};
    for (const row of allNodes) statusByKey[String(row.key)] = row.status;
    const progress = calculatePipelineProgress(statusByKey as any);

    const affectedRun = await trx("o_xiaoyuPipelineRun").where({ id: runId }).update({
      status: "queued",
      progress,
      currentNode: null,
      errorReason: null,
      finishedAt: null,
      options: JSON.stringify(options),
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now,
    });
    if (affectedRun !== 1) throw new Error("流水线状态已变化，请刷新后重试");

    await trx("o_xiaoyuPipelineEvent").insert({
      runId,
      nodeId: null,
      eventType: "run_reset",
      message: `已从“${nodeKey}”开始重新生产`,
      data: JSON.stringify({ nodeKey, downstream: nodeKeys, revision: revisions, options }),
      createdAt: now,
    });
  });

  // 事务提交后再删文件。清理失败只留下孤儿文件，不会让数据库引用消失文件。
  for (const filePath of files) await deleteFileBestEffort(filePath);
}
