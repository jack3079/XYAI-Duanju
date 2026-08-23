import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptId: z.number().int().positive(),
    page: z.number().int().min(1).max(1_000_000),
    limit: z.number().int().min(1).max(100),
    name: z.string().trim().max(200).optional().nullable(),
    projectId: z.number().int().positive().optional(),
  }),
  async (req, res) => {
    const { scriptId, page, limit, projectId } = req.body;
    const name = String(req.body.name || "").trim();
    if (projectId !== undefined) {
      const script = await u.db("o_script").where({ id: scriptId, projectId }).first("id");
      if (!script) return res.status(404).send(error("剧集不存在或不属于当前项目"));
    }

    const offset = (page - 1) * limit;
    let listQuery = u.db("o_storyboard").where({ scriptId });
    if (projectId !== undefined) listQuery = listQuery.where({ projectId });
    if (name) listQuery = listQuery.andWhere("title", "like", `%${name}%`);

    const storyboardData = await listQuery.clone().orderBy("id", "asc").offset(offset).limit(limit);
    const data = await Promise.all(storyboardData.map(async (item: any) => {
      const hasFile = item.filePath ? await u.oss.fileExists(item.filePath) : false;
      return {
        id: item.id,
        prompt: item.prompt,
        state: item.state === "已完成" && !hasFile ? "生成失败" : item.state,
        reason: item.state === "已完成" && !hasFile ? "分镜图片文件已丢失，请重新生成" : item.reason,
        src: hasFile ? await u.oss.getSmallImageUrl(item.filePath) : "",
      };
    }));

    let countQuery = u.db("o_storyboard").where({ scriptId });
    if (projectId !== undefined) countQuery = countQuery.where({ projectId });
    if (name) countQuery = countQuery.andWhere("title", "like", `%${name}%`);
    const totalQuery = await countQuery.count({ total: "*" }).first();
    res.status(200).send(success({ data, total: Number((totalQuery as any)?.total || 0) }));
  },
);
