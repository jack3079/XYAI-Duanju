import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    name: z.string().trim().min(1).max(200),
    describe: z.string().max(5000),
    type: z.enum(["role", "scene", "tool", "props"]),
    projectId: z.number().int().positive(),
    remark: z.string().max(5000).optional().nullable(),
    prompt: z.string().max(20000).optional().nullable(),
  }),
  async (req, res, next) => {
    try {
      const projectId = Number(req.body.projectId);
      const type = req.body.type === "props" ? "tool" : req.body.type;
      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) return res.status(404).send(error("项目不存在"));

      const [rawId] = await u.db("o_assets").insert({
        name: String(req.body.name).trim(),
        describe: req.body.describe,
        type,
        projectId,
        remark: req.body.remark ?? null,
        prompt: req.body.prompt ?? null,
        startTime: Date.now(),
      });
      const id = Number(rawId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("新增素材失败：未获得素材编号");
      return res.status(200).send(success({ id, projectId, type }, "新增素材成功"));
    } catch (exception) {
      next(exception);
    }
  },
);
