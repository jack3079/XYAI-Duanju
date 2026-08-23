import express from "express";
import db from "@/utils/db";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ensureXiaoyuPipelineSchema } from "@/xiaoyu/pipeline/database";
import { CUSTOM_POLICY_VERSION, getProjectProviderMode } from "@/xiaoyu/modelRouting";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.union([z.number(), z.string()]),
    name: z.string().min(1),
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
      if (!Number.isInteger(id) || id <= 0) throw new Error("无效的项目编号");

      const current = await db("o_project").where({ id }).first();
      if (!current) throw new Error("项目不存在");

      const imageModel = req.body.imageModel === undefined ? String(current.imageModel || "") : String(req.body.imageModel || "").trim();
      const videoModel = req.body.videoModel === undefined ? String(current.videoModel || "") : String(req.body.videoModel || "").trim();
      const providerMode = getProjectProviderMode({ imageModel, videoModel });
      const qualityMode = String(req.body.qualityMode || current.qualityMode || "standard");

      await db("o_project").where({ id }).update({
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
        computePresetVersion: providerMode === "unconfigured" ? "" : CUSTOM_POLICY_VERSION,
      });

      res.status(200).send(success({ id, providerMode, qualityMode }, "编辑项目成功"));
    } catch (error) {
      next(error);
    }
  },
);
