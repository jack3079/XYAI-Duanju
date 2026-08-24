import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    describe: z.string().max(5000),
    remark: z.string().max(5000).optional().nullable(),
    prompt: z.string().max(20000).optional().nullable(),
    projectId: z.number().int().positive().optional(),
  }),
  async (req, res, next) => {
    try {
      const { id, projectId } = req.body;
      const query = u.db("o_assets").where({ id });
      if (projectId) query.andWhere({ projectId });
      const exists = await query.clone().first("id");
      if (!exists) return res.status(404).send(error("素材不存在或不属于当前项目"));

      const affected = await query.update({
        name: String(req.body.name).trim(),
        describe: req.body.describe,
        remark: req.body.remark ?? null,
        prompt: req.body.prompt ?? null,
      });
      if (affected !== 1) return res.status(409).send(error("素材已变化，请刷新后重试"));
      return res.status(200).send(success({ id }, "更新素材成功"));
    } catch (exception) {
      next(exception);
    }
  },
);
