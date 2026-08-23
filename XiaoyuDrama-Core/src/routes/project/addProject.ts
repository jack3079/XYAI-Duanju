import express from "express";
import db from "@/utils/db";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ensureXiaoyuPipelineSchema } from "@/xiaoyu/pipeline/database";
import { CUSTOM_POLICY_VERSION, getProjectProviderMode } from "@/xiaoyu/modelRouting";
import { validateProjectModelSelections } from "@/utils/projectModelValidation";

const router = express.Router();

async function createProjectId(): Promise<number> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const exists = await db("o_project").where({ id }).first("id");
    if (!exists) return id;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("生成项目编号失败，请重试");
}

export default router.post(
  "/",
  validateFields({
    projectType: z.enum(["novel", "script"]).optional(),
    name: z.string().trim().min(1).max(200),
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
      await ensureXiaoyuPipelineSchema();
      const imageModel = String(req.body.imageModel || "").trim();
      const videoModel = String(req.body.videoModel || "").trim();
      await validateProjectModelSelections(imageModel, videoModel);

      const providerMode = getProjectProviderMode({ imageModel, videoModel });
      const qualityMode = String(req.body.qualityMode || "standard");
      const id = await createProjectId();
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
        computePresetVersion: providerMode === "xiaoyu" || providerMode === "unconfigured" ? "" : CUSTOM_POLICY_VERSION,
      });

      res.status(200).send(success(
        { id, providerMode, qualityMode },
        providerMode === "unconfigured"
          ? "新增项目成功；图片/视频模型尚未配置完整，可稍后补充"
          : "新增项目成功，已验证并保留用户选择的 AI 模型配置",
      ));
    } catch (error) {
      next(error);
    }
  },
);
