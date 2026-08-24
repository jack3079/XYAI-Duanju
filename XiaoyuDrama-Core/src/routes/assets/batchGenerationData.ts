import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    type: z.enum(["role", "scene", "tool", "props", "clip"]),
    name: z.string().trim().max(200).optional(),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async (req, res, next) => {
    try {
      const projectId = Number(req.body.projectId);
      const type = req.body.type === "props" ? "tool" : req.body.type;
      const page = Number(req.body.page || 1);
      const limit = Number(req.body.limit || 10);
      const name = String(req.body.name || "").trim();

      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) return res.status(404).send(error("项目不存在"));

      let query = u.db("o_assets")
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .where("o_assets.projectId", projectId)
        .andWhere("o_assets.type", type)
        .whereNull("o_assets.assetsId");
      if (name) query = query.andWhere("o_assets.name", "like", `%${name}%`);

      const rows = await query.clone()
        .select("o_assets.*", "o_image.filePath", "o_image.state", "o_image.errorReason")
        .orderBy("o_assets.id", "desc")
        .offset((page - 1) * limit)
        .limit(limit);

      const data = await Promise.all(rows.map(async (row: any) => {
        let filePath = "";
        if (row.filePath) {
          try {
            filePath = ["role", "scene", "tool", "props"].includes(String(row.type || ""))
              ? await u.oss.getSmallImageUrl(row.filePath)
              : await u.oss.getFileUrl(row.filePath);
          } catch (exception) {
            console.warn(`[assets] 批量素材预览 URL 生成失败：${row.id}`, exception);
          }
        }
        return { ...row, filePath };
      }));

      let countQuery = u.db("o_assets")
        .where({ projectId, type })
        .whereNull("assetsId");
      if (name) countQuery = countQuery.andWhere("name", "like", `%${name}%`);
      const countRow = await countQuery.count({ total: "id" }).first();
      const total = Number((countRow as any)?.total || 0);

      return res.status(200).send(success({ data, total, page, limit }));
    } catch (exception) {
      next(exception);
    }
  },
);
