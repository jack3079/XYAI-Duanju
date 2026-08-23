import express from "express";
import db from "@/utils/db";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ensureXiaoyuPipelineSchema } from "@/xiaoyu/pipeline/database";
import { CUSTOM_POLICY_VERSION, getProjectProviderMode } from "@/xiaoyu/modelRouting";

const router = express.Router();

function createProjectId(): number {
  // 毫秒时间戳 * 1000 + 随机尾数，仍处于 JavaScript 安全整数范围。
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

export default router.post(
  "/",
  validateFields({
    projectType: z.enum(["novel", "script"]).optional(),
    name: z.string().min(1),
    intro: z.string().optional(),
    type: z.string().optional(),
    artStyle: z.string().optional(),
    directorManual: z.string().optional(),
    videoRatio: z.enum(["16:9", "9:16"]).optional(),
    imageModel: z.string().optional(),
    videoModel: z.string().optional(),
    imageQuality: z.enum(["1K", "2K", "4K", ""]).optional(),
    mode: z.string().optional(),
    qualityMode: z.enum(["quality", "standard", "economy"]).optional(),
  }),
  async (req, res, next) => {
    try {
      // 兼容旧数据库：项目字段缺失时先完成本地迁移，避免 INSERT 直接失败。
      await ensureXiaoyuPipelineSchema();

      const imageModel = String(req.body.imageModel || "").trim();
      const videoModel = String(req.body.videoModel || "").trim();
      const providerMode = getProjectProviderMode({ imageModel, videoModel });
      const qualityMode = String(req.body.qualityMode || "standard");
      const id = createProjectId();

      await db("o_project").insert({
        id,
        projectType: req.body.projectType || "novel",
        name: String(req.body.name).trim(),
        intro: String(req.body.intro || ""),
        type: String(req.body.type || "").trim(),
        artStyle: String(req.body.artStyle || ""),
        videoRatio: req.body.videoRatio || "16:9",
        directorManual: String(req.body.directorManual || ""),
        userId: 1,
        imageModel,
        videoModel,
        createTime: Date.now(),
        imageQuality: String(req.body.imageQuality || "2K"),
        mode: String(req.body.mode || ""),
        qualityMode,
        // 不再从智算中心锁定远端策略；实际模型完全以用户配置为准。
        computePresetVersion: providerMode === "unconfigured" ? "" : CUSTOM_POLICY_VERSION,
      });

      res.status(200).send(success(
        { id, providerMode, qualityMode },
        providerMode === "unconfigured"
          ? "新增项目成功；可稍后配置 AI 模型"
          : "新增项目成功，已保留用户选择的 AI 模型配置",
      ));
    } catch (error) {
      next(error);
    }
  },
);
