import db from "@/utils/db";

const TERMINAL_REMOTE = ["completed", "failed", "cancelled"];
const INTERRUPTION_REASON = "服务重启或异常退出导致本地生成任务中断，请重新生成";

function numericSet(rows: any[], key: string): Set<number> {
  return new Set(rows
    .map((row) => Number(row?.[key] || 0))
    .filter((value) => Number.isSafeInteger(value) && value > 0));
}

export interface InterruptedWorkRecoveryResult {
  tasks: number;
  videos: number;
  tracks: number;
  storyboards: number;
  images: number;
  assetPrompts: number;
  protectedRemoteVideos: number;
  protectedRemoteTracks: number;
}

export async function recoverInterruptedLocalWork(): Promise<InterruptedWorkRecoveryResult> {
  const remoteRows = await db("o_xiaoyuRemoteJob")
    .whereNotIn("status", TERMINAL_REMOTE)
    .select("capability", "localArtifactId", "entityId");
  const remoteVideoRows = remoteRows.filter((row: any) => String(row.capability || "") === "video.generate");
  const protectedVideoIds = numericSet(remoteVideoRows, "localArtifactId");
  const protectedTrackIds = numericSet(remoteVideoRows, "entityId");

  return db.transaction(async (trx: any) => {
    const tasks = await trx("o_tasks").where({ state: "进行中" }).update({
      state: "生成失败",
      reason: INTERRUPTION_REASON,
    });

    let videoQuery = trx("o_video").where({ state: "生成中" });
    if (protectedVideoIds.size) videoQuery = videoQuery.whereNotIn("id", [...protectedVideoIds]);
    const videos = await videoQuery.update({ state: "生成失败", errorReason: INTERRUPTION_REASON });

    let trackQuery = trx("o_videoTrack").where({ state: "生成中" });
    if (protectedTrackIds.size) trackQuery = trackQuery.whereNotIn("id", [...protectedTrackIds]);
    const tracks = await trackQuery.update({ state: "生成失败", reason: INTERRUPTION_REASON });

    const storyboards = await trx("o_storyboard").where({ state: "生成中" }).update({
      state: "生成失败",
      reason: INTERRUPTION_REASON,
    });
    const images = await trx("o_image").where({ state: "生成中" }).update({
      state: "生成失败",
      errorReason: INTERRUPTION_REASON,
    });
    const assetPrompts = await trx("o_assets").where({ promptState: "生成中" }).update({
      promptState: "生成失败",
      promptErrorReason: INTERRUPTION_REASON,
    });

    return {
      tasks: Number(tasks || 0),
      videos: Number(videos || 0),
      tracks: Number(tracks || 0),
      storyboards: Number(storyboards || 0),
      images: Number(images || 0),
      assetPrompts: Number(assetPrompts || 0),
      protectedRemoteVideos: protectedVideoIds.size,
      protectedRemoteTracks: protectedTrackIds.size,
    };
  });
}
