import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");
const SYSTEM_PROVIDER_IDS = new Set(["xiaoyu_compute_center"]);

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema }),
  async (req, res) => {
    try {
      const { id } = req.body;
      if (SYSTEM_PROVIDER_IDS.has(id)) {
        return res.status(400).send(error("这是系统内置的可选 Provider，不能删除；不使用时直接关闭“启用”即可，不会绑定或覆盖你的 AI 模型"));
      }

      const existing = await u.db("o_vendorConfig").where("id", id).first("id");
      if (!existing) return res.status(404).send(error("供应商不存在"));
      const prefix = `${id}:%`;

      // 删除前不允许仍有使用该 Provider 的项目处在手工生成状态。
      const projectRows = await u.db("o_project")
        .where("imageModel", "like", prefix)
        .orWhere("videoModel", "like", prefix)
        .select("id");
      const projectIds = [...new Set(projectRows.map((row: any) => Number(row.id)).filter((value: number) => value > 0))];
      if (projectIds.length) {
        const runningVideo = await u.db("o_video").whereIn("projectId", projectIds).where({ state: "生成中" }).first("id", "projectId");
        const runningTrack = runningVideo ? null : await u.db("o_videoTrack").whereIn("projectId", projectIds).where({ state: "生成中" }).first("id", "projectId");
        const runningStoryboard = runningVideo || runningTrack ? null : await u.db("o_storyboard").whereIn("projectId", projectIds).where({ state: "生成中" }).first("id", "projectId");
        const active = runningVideo || runningTrack || runningStoryboard;
        if (active) return res.status(409).send(error(`仍有项目正在使用该 Provider 生成内容（项目 ${active.projectId}），请等待任务结束后再删除`));
      }

      const agentUsesProvider = await u.db("o_agentDeploy").where("vendorId", id).orWhere("modelName", "like", prefix).first("id", "name");
      if (agentUsesProvider) {
        const activeRun = await u.db("o_xiaoyuPipelineRun").whereIn("status", ["queued", "running", "pause_requested", "cancel_requested"]).first("id", "projectId");
        const activePrompt = activeRun ? null : await u.db("o_videoTrack").where({ state: "生成中" }).first("id", "projectId");
        if (activeRun || activePrompt) {
          return res.status(409).send(error(`该 Provider 正被 Agent 配置使用，且系统仍有生成任务执行中，请等待任务结束后再删除`));
        }
      }

      await u.db.transaction(async (trx: any) => {
        const affected = await trx("o_vendorConfig").where("id", id).delete();
        if (affected !== 1) throw new Error("供应商配置已变化，请刷新后重试");
        await trx("o_agentDeploy").where("vendorId", id).orWhere("modelName", "like", prefix).update({ model: null, modelName: null, vendorId: null });
        await trx("o_project").where("imageModel", "like", prefix).update({ imageModel: "", computePresetVersion: "" });
        await trx("o_project").where("videoModel", "like", prefix).update({ videoModel: "", computePresetVersion: "" });
      });
      u.vendor.deleteCode(id);
      res.status(200).send(success("删除成功；引用该 Provider 的项目/Agent 配置已安全解除"));
    } catch (exception) {
      const status = Number((exception as any)?.status || 400);
      res.status(status >= 400 && status <= 599 ? status : 400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
