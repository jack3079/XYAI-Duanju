import pLimit from "p-limit";
import u from "@/utils";
import {
  generateTrackVideoPrompt,
  validateVideoPromptTask,
  type VideoPromptTaskInput,
} from "@/utils/workbenchVideoPrompt";

function conflict(message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = 409;
  return error;
}

export async function claimVideoPromptTracks(inputs: VideoPromptTaskInput[]): Promise<void> {
  if (!inputs.length) return;
  const seen = new Set<number>();
  for (const input of inputs) {
    if (seen.has(input.trackId)) throw conflict(`轨道 ${input.trackId} 在本次请求中重复`);
    seen.add(input.trackId);
  }

  // 先做素材/归属校验；真正的占用在一个事务内完成，避免半批次进入生成中。
  const validated = await Promise.all(inputs.map(async (input) => ({
    input,
    ...(await validateVideoPromptTask(input)),
  })));

  await u.db.transaction(async (trx: any) => {
    for (const item of validated) {
      const affected = await trx("o_videoTrack")
        .where({ id: item.input.trackId, projectId: item.input.projectId, scriptId: item.scriptId })
        .andWhere((builder: any) => builder.whereNull("state").orWhereNot("state", "生成中"))
        .update({ state: "生成中", reason: null });
      if (affected !== 1) throw conflict(`轨道 ${item.input.trackId} 已有生成任务正在执行，请等待完成后再试`);
    }
  });
}

export async function runClaimedVideoPrompt(input: VideoPromptTaskInput, context: any): Promise<string> {
  try {
    return await generateTrackVideoPrompt(input, context);
  } catch (exception) {
    const message = u.error(exception).message;
    await u.db("o_videoTrack")
      .where({ id: input.trackId, projectId: input.projectId })
      .update({ state: "生成失败", reason: message })
      .catch((dbError: unknown) => console.error("[视频提示词] 写入占用任务失败状态失败", u.error(dbError).message));
    throw exception;
  }
}

export function launchClaimedVideoPromptBatch(inputs: VideoPromptTaskInput[], context: any, concurrentCount: number): void {
  const concurrency = Math.min(Math.max(Math.trunc(Number(concurrentCount) || 3), 1), 10);
  const limit = pLimit(concurrency);
  const tasks = inputs.map((input) => limit(async () => {
    try {
      await runClaimedVideoPrompt(input, context);
    } catch (exception) {
      console.error(`[视频提示词] track=${input.trackId} 生成失败:`, u.error(exception).message);
    }
  }));
  void Promise.all(tasks).catch((exception) => console.error("[视频提示词] 批量后台任务异常", u.error(exception).message));
}
