import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import u from "@/utils";
import db from "@/utils/db";
import { cancelXiaoyuJob, getXiaoyuJob, type XiaoyuRemoteJobView } from "../computeCenterClient";
import { appendPipelineEvent } from "./repository";

const terminal = new Set(["completed", "failed", "cancelled"]);
const maxResultBytes = 2 * 1024 * 1024 * 1024;

function boundedEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function remoteDownloadTimeoutMs(): number {
  return boundedEnvNumber("XIAOYU_REMOTE_DOWNLOAD_TIMEOUT_MS", 30 * 60 * 1000, 30_000, 2 * 60 * 60 * 1000);
}

function resolveOssPath(relativePath: string): string {
  const root = path.resolve(u.getPath("oss"));
  const safe = String(relativePath || "").replace(/^[/\\]+/, "");
  const target = path.resolve(root, safe);
  const relation = path.relative(root, target);
  if (!safe || relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("远程任务目标路径不在本地素材目录内");
  return target;
}

function validateResultUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("远程生成结果地址无效");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!local && url.protocol !== "https:") throw new Error("远程生成结果必须使用 HTTPS 下载");
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("远程生成结果地址协议无效");
  return url;
}

async function downloadResult(urlText: string, targetPath: string): Promise<void> {
  const url = validateResultUrl(urlText);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remoteDownloadTimeoutMs());
  const target = resolveOssPath(targetPath);
  const temporary = `${target}.${process.pid}.${Date.now()}.part`;

  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`下载远程生成结果失败（HTTP ${response.status}）`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxResultBytes) throw new Error("远程生成结果超过 2GB 安全限制");

    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    let received = 0;
    const source = Readable.fromWeb(response.body as any);
    source.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxResultBytes) source.destroy(new Error("远程生成结果超过 2GB 安全限制"));
    });

    await pipeline(source, fs.createWriteStream(temporary, { flags: "wx" }));
    if (received <= 0) throw new Error("远程生成结果为空文件");
    await fs.promises.rename(temporary, target);
  } catch (error: any) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    if (error?.name === "AbortError") throw new Error(`下载远程生成结果超时（${remoteDownloadTimeoutMs()}ms）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseStoredResult(row: any): any {
  try {
    const parsed = JSON.parse(String(row?.result || "null"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function updateRemoteRow(row: any, job: XiaoyuRemoteJobView): Promise<void> {
  const affected = await db("o_xiaoyuRemoteJob").where({ idempotencyKey: row.idempotencyKey }).update({
    status: job.status,
    result: job.result ? JSON.stringify(job.result) : row.result || null,
    errorReason: job.error || null,
    updatedAt: Date.now(),
  });
  if (affected !== 1) throw new Error(`远程任务记录已变化：${row.idempotencyKey}`);
}

async function findLocalVideo(row: any): Promise<any> {
  const artifactId = Number(row.localArtifactId || 0);
  if (artifactId) {
    const exact = await db("o_video").where({ id: artifactId }).first();
    if (exact) return exact;
  }
  const trackId = Number(row.entityId || 0);
  if (!trackId) return null;
  return db("o_video")
    .where({ projectId: row.projectId, videoTrackId: trackId })
    .orderBy("time", "desc")
    .first();
}

async function settleVideo(row: any, job: XiaoyuRemoteJobView): Promise<void> {
  const trackId = Number(row.entityId || 0);
  if (!trackId) throw new Error(`远程视频任务缺少本地 trackId：${row.idempotencyKey}`);
  const video = await findLocalVideo(row);
  if (!video) throw new Error(`远程视频任务找不到本地视频记录：trackId=${trackId}`);

  if (job.status === "completed") {
    const resultUrl = String(job.result?.url || parseStoredResult(row)?.url || "");
    if (!resultUrl) throw new Error("远程视频任务已完成但缺少结果地址");
    const targetFile = String(video.filePath || row.targetFilePath || "").trim();
    if (!targetFile) throw new Error("远程视频任务缺少本地保存路径");
    if (!(await u.oss.fileExists(targetFile))) await downloadResult(resultUrl, targetFile);

    await db.transaction(async (trx: any) => {
      const videoAffected = await trx("o_video").where({ id: video.id }).update({ state: "生成成功", errorReason: null });
      if (videoAffected !== 1) throw new Error(`本地视频记录已变化：${video.id}`);
      const trackAffected = await trx("o_videoTrack").where({ id: trackId }).update({
        state: "已完成",
        selectVideoId: video.id,
        videoId: video.id,
        reason: null,
      });
      if (trackAffected !== 1) throw new Error(`本地视频轨道已变化：${trackId}`);
    });
  } else if (job.status === "failed" || job.status === "cancelled") {
    const message = job.error || (job.status === "cancelled" ? "远程任务已取消" : "远程任务失败");
    await db.transaction(async (trx: any) => {
      await trx("o_video").where({ id: video.id }).update({ state: "生成失败", errorReason: message });
      await trx("o_videoTrack").where({ id: trackId }).update({ state: "生成失败", reason: message });
    });
  }
}

function cachedCompletedJob(row: any): XiaoyuRemoteJobView | null {
  if (String(row?.status) !== "completed") return null;
  const result = parseStoredResult(row);
  if (!result) return null;
  return {
    id: String(row.remoteJobId || ""),
    status: "completed",
    result,
    error: null,
  } as XiaoyuRemoteJobView;
}

export async function reconcileRemoteJobsForRun(
  runId: string,
  requestCancellation = false,
): Promise<{ outstanding: number; settled: number; cancellationDeferred: number }> {
  // completed 的 video.generate 也必须参与恢复：远端可能已完成，但本地下载/落库在上次进程中断。
  const rows = await db("o_xiaoyuRemoteJob")
    .where({ runId })
    .andWhere((builder: any) => {
      builder.whereNotIn("status", ["completed", "failed", "cancelled"])
        .orWhere((nested: any) => nested.where({ status: "completed", capability: "video.generate" }));
    })
    .orderBy("createdAt", "asc");

  let outstanding = 0;
  let settled = 0;
  let cancellationDeferred = 0;

  for (const row of rows) {
    if (!row.remoteJobId) {
      outstanding += 1;
      continue;
    }

    let job: XiaoyuRemoteJobView;
    const cached = row.capability === "video.generate" ? cachedCompletedJob(row) : null;
    if (cached && !requestCancellation) {
      job = cached;
    } else if (requestCancellation && String(row.status) !== "completed") {
      try {
        job = await cancelXiaoyuJob(String(row.remoteJobId));
      } catch (error) {
        cancellationDeferred += 1;
        job = await getXiaoyuJob(String(row.remoteJobId));
        await appendPipelineEvent(runId, "remote_cancel_deferred", "上游暂不支持安全取消，继续等待真实结算结果", {
          remoteJobId: row.remoteJobId,
          capability: row.capability,
          error: u.error(error).message,
        });
      }
    } else {
      job = await getXiaoyuJob(String(row.remoteJobId));
    }

    // 先完成本地结算，再把远程记录推进到 terminal 状态。
    // 这样下载失败时记录仍可在下一轮继续恢复，不会因为 completed 被永久跳过。
    if (row.capability === "video.generate" && terminal.has(job.status)) await settleVideo(row, job);
    await updateRemoteRow(row, job);

    if (terminal.has(job.status)) settled += 1;
    else outstanding += 1;
  }
  return { outstanding, settled, cancellationDeferred };
}
