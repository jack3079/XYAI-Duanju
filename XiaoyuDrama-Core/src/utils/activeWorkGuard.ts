import db from "@/utils/db";

interface ActiveWork {
  kind: string;
  id?: string | number | null;
  detail?: string;
}

function describe(work: ActiveWork | null): string | null {
  if (!work) return null;
  return `${work.kind}${work.id === undefined || work.id === null ? "" : `（${work.id}）`}${work.detail ? `：${work.detail}` : ""}`;
}

async function firstProjectWork(projectId: number): Promise<ActiveWork | null> {
  const video = await db("o_video").where({ projectId, state: "生成中" }).first("id", "videoTrackId");
  if (video) return { kind: "视频生成任务", id: video.id, detail: video.videoTrackId ? `轨道 ${video.videoTrackId}` : undefined };

  const track = await db("o_videoTrack").where({ projectId, state: "生成中" }).first("id", "scriptId");
  if (track) return { kind: "视频轨道任务", id: track.id, detail: track.scriptId ? `剧集 ${track.scriptId}` : undefined };

  const storyboard = await db("o_storyboard").where({ projectId, state: "生成中" }).first("id", "scriptId");
  if (storyboard) return { kind: "分镜图片任务", id: storyboard.id, detail: storyboard.scriptId ? `剧集 ${storyboard.scriptId}` : undefined };

  const assetPrompt = await db("o_assets").where({ projectId, promptState: "生成中" }).first("id", "scriptId");
  if (assetPrompt) return { kind: "资产提示词任务", id: assetPrompt.id, detail: assetPrompt.scriptId ? `剧集 ${assetPrompt.scriptId}` : undefined };

  const assetImage = await db("o_image")
    .join("o_assets", "o_assets.id", "o_image.assetsId")
    .where({ "o_assets.projectId": projectId, "o_image.state": "生成中" })
    .first("o_image.id", "o_assets.id as assetId", "o_assets.scriptId");
  if (assetImage) return { kind: "资产图片任务", id: assetImage.id, detail: `资产 ${assetImage.assetId}` };

  const task = await db("o_tasks").where({ projectId, state: "进行中" }).orderBy("startTime", "asc").first("id", "taskClass");
  if (task) return { kind: "AI任务", id: task.id, detail: String(task.taskClass || "进行中") };

  return null;
}

async function firstScriptWork(scriptIds: number[]): Promise<ActiveWork | null> {
  if (!scriptIds.length) return null;

  const video = await db("o_video").whereIn("scriptId", scriptIds).where({ state: "生成中" }).first("id", "scriptId");
  if (video) return { kind: "视频生成任务", id: video.id, detail: `剧集 ${video.scriptId}` };

  const track = await db("o_videoTrack").whereIn("scriptId", scriptIds).where({ state: "生成中" }).first("id", "scriptId");
  if (track) return { kind: "视频轨道任务", id: track.id, detail: `剧集 ${track.scriptId}` };

  const storyboard = await db("o_storyboard").whereIn("scriptId", scriptIds).where({ state: "生成中" }).first("id", "scriptId");
  if (storyboard) return { kind: "分镜图片任务", id: storyboard.id, detail: `剧集 ${storyboard.scriptId}` };

  const assetPrompt = await db("o_assets").whereIn("scriptId", scriptIds).where({ promptState: "生成中" }).first("id", "scriptId");
  if (assetPrompt) return { kind: "资产提示词任务", id: assetPrompt.id, detail: `剧集 ${assetPrompt.scriptId}` };

  const assetImage = await db("o_image")
    .join("o_assets", "o_assets.id", "o_image.assetsId")
    .whereIn("o_assets.scriptId", scriptIds)
    .where({ "o_image.state": "生成中" })
    .first("o_image.id", "o_assets.id as assetId", "o_assets.scriptId");
  if (assetImage) return { kind: "资产图片任务", id: assetImage.id, detail: `剧集 ${assetImage.scriptId}` };

  // taskRecord 的 relatedObjects 由 JSON.stringify 生成；按 scriptId 的 JSON 边界匹配，避免 12 误匹配 123。
  const task = await db("o_tasks")
    .where({ state: "进行中" })
    .andWhere((builder: any) => {
      for (const scriptId of scriptIds) {
        builder.orWhere("relatedObjects", "like", `%\"scriptId\":${scriptId},%`)
          .orWhere("relatedObjects", "like", `%\"scriptId\":${scriptId}}%`);
      }
    })
    .orderBy("startTime", "asc")
    .first("id", "taskClass");
  if (task) return { kind: "AI任务", id: task.id, detail: String(task.taskClass || "进行中") };

  return null;
}

export async function projectActiveWorkMessage(projectId: number): Promise<string | null> {
  return describe(await firstProjectWork(projectId));
}

export async function scriptsActiveWorkMessage(scriptIds: number[]): Promise<string | null> {
  return describe(await firstScriptWork(scriptIds));
}
