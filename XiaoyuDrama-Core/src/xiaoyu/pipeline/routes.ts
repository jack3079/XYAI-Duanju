import express from "express";
import db from "@/utils/db";
import { error, success } from "@/lib/responseFormat";
import { xiaoyuPipelineEngine } from "./engine";
import {
  createPipelineRun,
  getPipelineRun,
  listProjectPipelineRuns,
  requestCancel,
  requestPause,
  resumeRun,
} from "./repository";
import { safeResetRunFromNode } from "./safeReset";
import { PIPELINE_NODES, defaultPipelineOptions } from "./stateMachine";
import type { PipelineNodeKey, PipelineOptions } from "./types";
import { CUSTOM_POLICY_VERSION, getProjectProviderMode } from "../modelRouting";

const router = express.Router();

function fail(res: express.Response, exception: unknown): void {
  const message = exception instanceof Error ? exception.message : String(exception);
  const status = /不存在|未找到/.test(message)
    ? 404
    : /已有未结束|不能|非法|无效|未结算/.test(message)
      ? 409
      : 400;
  res.status(status).send(error(message, { supportWechat: "echo169369" }));
}

function parseProjectId(value: unknown): number {
  const projectId = Number(value);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error("无效的项目编号");
  return projectId;
}

function parseNodeKey(value: unknown): PipelineNodeKey {
  const key = String(value || "") as PipelineNodeKey;
  if (!PIPELINE_NODES.some((node) => node.key === key)) throw new Error("无效的生产节点");
  return key;
}

router.get("/definitions", (_req, res) => {
  res.send(success(PIPELINE_NODES));
});

router.post("/projects/:projectId/runs", async (req, res) => {
  try {
    const projectId = parseProjectId(req.params.projectId);
    const project = await db("o_project").where({ id: projectId }).first();
    if (!project) throw new Error("项目不存在");
    const qualityMode = ["quality", "standard", "economy"].includes(String(project.qualityMode || ""))
      ? String(project.qualityMode)
      : "standard";
    const providerMode = getProjectProviderMode(project);
    if (providerMode === "unconfigured") {
      throw new Error("项目尚未配置图片/视频模型。请在项目编辑中选择要使用的 AI 模型");
    }

    const policyVersion = providerMode === "xiaoyu" ? "" : CUSTOM_POLICY_VERSION;
    const options = defaultPipelineOptions((req.body || {}) as Partial<PipelineOptions>);
    const computeAudioDisabled = providerMode !== "xiaoyu" && (options.enableVoice || options.enableMusic);
    if (providerMode !== "xiaoyu") {
      options.enableVoice = false;
      options.enableMusic = false;
    }

    const runId = await createPipelineRun(projectId, qualityMode as any, policyVersion, options);
    xiaoyuPipelineEngine.wake();
    res.status(201).send(success(
      await getPipelineRun(runId),
      computeAudioDisabled
        ? "一键生产任务已创建；文本/图片/视频按用户配置运行，已关闭未显式配置的智算中心专属配音/音乐"
        : "一键生产任务已创建",
    ));
  } catch (exception) {
    fail(res, exception);
  }
});

router.get("/projects/:projectId/runs", async (req, res) => {
  try {
    const projectId = parseProjectId(req.params.projectId);
    res.send(success(await listProjectPipelineRuns(projectId, Number(req.query.limit || 20))));
  } catch (exception) {
    fail(res, exception);
  }
});

router.get("/runs/:runId", async (req, res) => {
  try {
    res.send(success(await getPipelineRun(String(req.params.runId))));
  } catch (exception) {
    fail(res, exception);
  }
});

router.post("/runs/:runId/pause", async (req, res) => {
  try {
    await requestPause(String(req.params.runId));
    xiaoyuPipelineEngine.wake();
    res.send(success(await getPipelineRun(String(req.params.runId)), "已请求暂停"));
  } catch (exception) {
    fail(res, exception);
  }
});

router.post("/runs/:runId/resume", async (req, res) => {
  try {
    await resumeRun(String(req.params.runId));
    xiaoyuPipelineEngine.wake();
    res.send(success(await getPipelineRun(String(req.params.runId)), "已继续生产"));
  } catch (exception) {
    fail(res, exception);
  }
});

router.post("/runs/:runId/cancel", async (req, res) => {
  try {
    await requestCancel(String(req.params.runId));
    xiaoyuPipelineEngine.wake();
    res.send(success(await getPipelineRun(String(req.params.runId)), "已请求取消"));
  } catch (exception) {
    fail(res, exception);
  }
});

router.post("/runs/:runId/rerun", async (req, res) => {
  try {
    const nodeKey = parseNodeKey(req.body?.nodeKey);
    await safeResetRunFromNode(String(req.params.runId), nodeKey);
    xiaoyuPipelineEngine.wake();
    res.send(success(await getPipelineRun(String(req.params.runId)), `已从 ${nodeKey} 重新生产`));
  } catch (exception) {
    fail(res, exception);
  }
});

export default router;
