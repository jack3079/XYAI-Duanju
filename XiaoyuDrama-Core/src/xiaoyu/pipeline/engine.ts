import os from "node:os";
import u from "@/utils";
import db from "@/utils/db";
import { buildPipelineExecutionContext } from "./context";
import { PipelineCancelRequested, PipelinePauseRequested } from "./errors";
import { PIPELINE_EXECUTORS } from "./executors";
import {
  appendPipelineEvent,
  getPipelineRun,
  refreshRunProgress,
  updateNodeStatus,
  updateRunStatus,
} from "./repository";
import { PIPELINE_NODES } from "./stateMachine";
import { reconcileRemoteJobsForRun } from "./remoteRecovery";
import type { PipelineNodeRow, PipelineRunRow } from "./types";

function boundedEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

class XiaoyuPipelineEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopping = false;
  private readonly owner = `${os.hostname()}:${process.pid}`;
  private readonly leaseMs = boundedEnvNumber("XIAOYU_PIPELINE_LEASE_MS", 90_000, 30_000, 10 * 60_000);
  private readonly tickMs = boundedEnvNumber("XIAOYU_PIPELINE_TICK_MS", 1200, 250, 30_000);

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.recoverExpiredRuns();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    await this.tick();
  }

  async stop(timeoutMs = 10_000): Promise<boolean> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this.ticking && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!this.ticking) {
      await db("o_xiaoyuPipelineRun")
        .where({ leaseOwner: this.owner })
        .update({ leaseOwner: null, leaseUntil: null, updatedAt: Date.now() });
      return true;
    }
    // 仍有原子任务在执行时不主动释放 lease；让它自然过期，避免另一个实例并发接管。
    return false;
  }

  wake(): void {
    if (!this.stopping) void this.tick();
  }

  private async recoverExpiredRuns(): Promise<number> {
    const now = Date.now();
    const candidates = await db("o_xiaoyuPipelineRun")
      .whereIn("status", ["running", "pause_requested", "cancel_requested"])
      .andWhere((builder: any) => builder.whereNull("leaseUntil").orWhere("leaseUntil", "<", now))
      .orderBy("updatedAt", "asc");

    let recovered = 0;
    for (const candidate of candidates) {
      const acquired = await db("o_xiaoyuPipelineRun")
        .where({ id: candidate.id })
        .whereIn("status", ["running", "pause_requested", "cancel_requested"])
        .andWhere((builder: any) => builder.whereNull("leaseUntil").orWhere("leaseUntil", "<", now))
        .update({ leaseOwner: this.owner, leaseUntil: now + this.leaseMs, updatedAt: now });
      if (!acquired) continue;

      await db.transaction(async (trx: any) => {
        const runningNodes = await trx("o_xiaoyuPipelineNode").where({ runId: candidate.id, status: "running" });
        for (const node of runningNodes) {
          await trx("o_xiaoyuPipelineNode").where({ id: node.id }).update({
            status: "pending",
            attempt: Math.max(0, Number(node.attempt || 0) - 1),
            errorReason: "上次实例中断后自动恢复",
            nextRunAt: now,
            updatedAt: now,
          });
        }

        const nextStatus = candidate.status === "cancel_requested"
          ? "cancel_requested"
          : candidate.status === "pause_requested"
            ? "paused"
            : "queued";
        await trx("o_xiaoyuPipelineRun").where({ id: candidate.id, leaseOwner: this.owner }).update({
          status: nextStatus,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: now,
        });
      });

      await appendPipelineEvent(candidate.id, "run_recovered", "检测到过期的流水线租约，已安全恢复任务", {
        previousStatus: candidate.status,
        leaseOwner: candidate.leaseOwner || null,
        leaseUntil: candidate.leaseUntil || null,
      });
      recovered += 1;
    }
    return recovered;
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.ticking) return;
    this.ticking = true;
    try {
      const run = (await db("o_xiaoyuPipelineRun")
        .whereIn("status", ["queued", "running", "pause_requested", "cancel_requested"])
        .andWhere((builder: any) => builder.whereNull("leaseUntil").orWhere("leaseUntil", "<", Date.now()).orWhere("leaseOwner", this.owner))
        .orderBy("createdAt", "asc")
        .first()) as PipelineRunRow | undefined;
      if (!run || this.stopping) return;

      const acquired = await db("o_xiaoyuPipelineRun")
        .where({ id: run.id })
        .andWhere((builder: any) => builder.whereNull("leaseUntil").orWhere("leaseUntil", "<", Date.now()).orWhere("leaseOwner", this.owner))
        .update({ leaseOwner: this.owner, leaseUntil: Date.now() + this.leaseMs, updatedAt: Date.now() });
      if (!acquired) return;
      await this.processRun(run.id);
    } catch (error) {
      console.error("[小鱼一键生产] 调度异常", u.error(error).message);
    } finally {
      this.ticking = false;
    }
  }

  private async processRun(runId: string): Promise<void> {
    let view = await getPipelineRun(runId, 0);
    let run = view.run;

    if (run.status === "cancel_requested") {
      const remote = await reconcileRemoteJobsForRun(runId, true);
      if (remote.outstanding > 0) {
        await db("o_xiaoyuPipelineRun").where({ id: runId, leaseOwner: this.owner }).update({ leaseOwner: null, leaseUntil: null, updatedAt: Date.now() });
        return;
      }
      await db("o_xiaoyuPipelineNode").where({ runId }).whereIn("status", ["pending", "paused", "failed", "running"]).update({ status: "cancelled", updatedAt: Date.now(), finishedAt: Date.now() });
      await updateRunStatus(runId, "cancelled", { currentNode: null, errorReason: "用户取消", leaseOwner: null, leaseUntil: null });
      await appendPipelineEvent(runId, "run_cancelled", "一键生产任务已取消；远程任务已经结算或确认终止", remote);
      return;
    }

    if (run.status === "pause_requested") {
      await updateRunStatus(runId, "paused", { currentNode: null, leaseOwner: null, leaseUntil: null });
      await appendPipelineEvent(runId, "run_paused", "一键生产任务已暂停");
      return;
    }

    if (run.status === "queued") {
      await updateRunStatus(runId, "running", { leaseOwner: this.owner, leaseUntil: Date.now() + this.leaseMs });
      view = await getPipelineRun(runId, 0);
      run = view.run;
    }

    await reconcileRemoteJobsForRun(runId, false);
    view = await getPipelineRun(runId, 0);
    run = view.run;
    const nodes = view.nodes as unknown as PipelineNodeRow[];
    const completed = new Set(nodes.filter((node) => ["completed", "skipped"].includes(node.status)).map((node) => node.key));
    const next = nodes.find((node) => {
      if (node.status !== "pending" || Number(node.nextRunAt || 0) > Date.now()) return false;
      const definition = PIPELINE_NODES.find((item) => item.key === node.key);
      if (!definition) return false;
      return definition.dependsOn.every((dependency) => completed.has(dependency));
    });

    if (!next) {
      const allDone = nodes.every((node) => ["completed", "skipped"].includes(node.status));
      if (allDone) {
        await refreshRunProgress(runId);
        await updateRunStatus(runId, "completed", { progress: 100, currentNode: null, errorReason: null, leaseOwner: null, leaseUntil: null });
        await appendPipelineEvent(runId, "run_completed", "一键短剧生产任务已完成");
      } else {
        await db("o_xiaoyuPipelineRun").where({ id: runId, leaseOwner: this.owner }).update({ leaseOwner: null, leaseUntil: null, updatedAt: Date.now() });
      }
      return;
    }

    const attempt = Number(next.attempt || 0) + 1;
    await updateNodeStatus(next.id, "running", { attempt, errorReason: null });
    await db("o_xiaoyuPipelineRun").where({ id: runId, leaseOwner: this.owner }).update({ currentNode: next.key, leaseUntil: Date.now() + this.leaseMs, updatedAt: Date.now() });
    await appendPipelineEvent(runId, "node_started", `开始：${next.name}`, { nodeKey: next.key, attempt }, next.id);

    try {
      const fresh = await getPipelineRun(runId, 0);
      const freshRun = fresh.run;
      const freshNode = fresh.nodes.find((node: any) => node.id === next.id) as unknown as PipelineNodeRow;
      if (!freshNode) throw new Error(`流水线节点已不存在：${next.id}`);
      const context = await buildPipelineExecutionContext(freshRun, freshNode, freshRun.options);
      const heartbeat = setInterval(() => {
        void db("o_xiaoyuPipelineRun")
          .where({ id: runId, leaseOwner: this.owner })
          .update({ leaseUntil: Date.now() + this.leaseMs, updatedAt: Date.now() })
          .then((affected: number) => {
            if (!affected) console.warn(`[小鱼一键生产] 续租失效：run=${runId}`);
          })
          .catch((error: unknown) => console.warn("[小鱼一键生产] 续租失败", u.error(error).message));
      }, Math.max(10_000, Math.floor(this.leaseMs / 3)));

      let output: Record<string, unknown>;
      try {
        output = await PIPELINE_EXECUTORS[next.key](context);
      } finally {
        clearInterval(heartbeat);
      }

      await updateNodeStatus(next.id, "completed", { output: JSON.stringify(output), errorReason: null });
      const progress = await refreshRunProgress(runId);
      await appendPipelineEvent(runId, "node_completed", `完成：${next.name}`, { nodeKey: next.key, progress }, next.id);
      if (freshRun.options.stopAfterNode === next.key) await updateRunStatus(runId, "pause_requested");
    } catch (error) {
      if (error instanceof PipelinePauseRequested) {
        await updateNodeStatus(next.id, "paused", { errorReason: null });
        await updateRunStatus(runId, "paused", { currentNode: null, leaseOwner: null, leaseUntil: null });
        await appendPipelineEvent(runId, "run_paused", `已在“${next.name}”安全暂停`, {}, next.id);
        return;
      }
      if (error instanceof PipelineCancelRequested) {
        await updateNodeStatus(next.id, "cancelled", { errorReason: "用户取消" });
        await updateRunStatus(runId, "cancelled", { currentNode: null, errorReason: "用户取消", leaseOwner: null, leaseUntil: null });
        await appendPipelineEvent(runId, "run_cancelled", `已在“${next.name}”取消`, {}, next.id);
        return;
      }

      const message = u.error(error).message;
      const canRetry = attempt < Number(next.maxAttempts || 1);
      if (canRetry) {
        const delay = Math.min(120_000, 3_000 * 2 ** Math.max(0, attempt - 1));
        await updateNodeStatus(next.id, "pending", { errorReason: message, nextRunAt: Date.now() + delay });
        await appendPipelineEvent(runId, "node_retry", `${next.name}失败，将自动重试`, { nodeKey: next.key, attempt, delay, error: message }, next.id);
      } else {
        await updateNodeStatus(next.id, "failed", { errorReason: message });
        await updateRunStatus(runId, "failed", { currentNode: next.key, errorReason: message, leaseOwner: null, leaseUntil: null });
        await appendPipelineEvent(runId, "run_failed", `${next.name}失败：${message}`, { nodeKey: next.key, attempt }, next.id);
        return;
      }
    }

    await db("o_xiaoyuPipelineRun").where({ id: runId, leaseOwner: this.owner }).update({ leaseOwner: null, leaseUntil: null, updatedAt: Date.now() });
    if (!this.stopping) setImmediate(() => void this.tick());
  }
}

export const xiaoyuPipelineEngine = new XiaoyuPipelineEngine();
