import express from "express";
import db from "@/utils/db";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ensureXiaoyuPipelineSchema } from "@/xiaoyu/pipeline/database";
import { CUSTOM_POLICY_VERSION, getProjectProviderMode } from "@/xiaoyu/modelRouting";
import { validateProjectModelSelections } from "@/utils/projectModelValidation";

const router = express.Router();

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

export default router.post(
  "/",
  validateFields({
    id: z.union([z.number(), z.string()]),
    name: z.string().trim().min(1).max(200),
    intro: z.string().optional(),
    type: z.string().optional(),
    artStyle: z.string().optional(),
    directorManual: z.string().optional(),
    videoRatio: z.enum(["16:9", "9:16"]).optional(),
    projectType: z.enum(["novel", "script"]).optional(),
    imageModel: z.string().optional(),
    videoModel: z.string().optional(),
    imageQuality: z.enum(["1K", "2K", "4K", ""]).optional(),
    mode: z.string().optional(),
    qualityMode: z.enum(["quality", "standard", "economy"]).optional(),
  }),
  async (req, res, next) => {
    try {
      await ensureXiaoyuPipelineSchema();
      const id = Number(req.body.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "无效的项目编号");

      const current = await db("o_project").where({ id }).first();
      if (!current) throw httpError(404, "项目不存在");

      const imageModel = req.body.imageModel === undefined
        ? String(current.imageModel || "").trim()
        : String(req.body.imageModel || "").trim();
      const videoModel = req.body.videoModel === undefined
        ? String(current.videoModel || "").trim()
        : String(req.body.videoModel || "").trim();
      await validateProjectModelSelections(imageModel, videoModel);

      const providerMode = getProjectProviderMode({ imageModel, videoModel });
      const qualityMode = String(req.body.qualityMode || current.qualityMode || "standard");
      const affected = await db("o_project").where({ id }).update({
        name: String(req.body.name).trim(),
        intro: req.body.intro === undefined ? current.intro : String(req.body.intro || ""),
        type: req.body.type === undefined ? current.type : String(req.body.type || "").trim(),
        artStyle: req.body.artStyle === undefined ? current.artStyle : String(req.body.artStyle || ""),
        videoRatio: req.body.videoRatio || current.videoRatio || "16:9",
        directorManual: req.body.directorManual === undefined ? current.directorManual : String(req.body.directorManual || ""),
        projectType: req.body.projectType || current.projectType || "novel",
        imageModel,
        videoModel,
        imageQuality: req.body.imageQuality === undefined ? String(current.imageQuality || "2K") : String(req.body.imageQuality || ""),
        mode: req.body.mode === undefined ? String(current.mode || "") : String(req.body.mode || ""),
        qualityMode,
        computePresetVersion: providerMode === "xiaoyu" || providerMode === "unconfigured" ? "" : CUSTOM_POLICY_VERSION,
      });
      if (affected !== 1) throw httpError(409, "项目已变化，请刷新后重试");

      res.status(200).send(success(
        { id, providerMode, qualityMode },
        providerMode === "unconfigured" ? "编辑项目成功；图片/视频模型尚未配置完整" : "编辑项目成功",
      ));
    } catch (error) {
      next(error);
    }
  },
);
