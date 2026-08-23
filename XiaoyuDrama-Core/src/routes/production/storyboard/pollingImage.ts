import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number().int().positive()).max(300),
    projectId: z.number().int().positive().optional(),
    scriptId: z.number().int().positive().optional(),
  }),
  async (req, res) => {
    const ids = [...new Set<number>(req.body.ids)];
    if (!ids.length) return res.status(200).send(success([]));
    if (ids.length !== req.body.ids.length) return res.status(400).send(error("轮询分镜列表包含重复 id"));

    let query = u.db("o_storyboard").whereIn("id", ids).whereNot("state", "生成中");
    if (req.body.projectId !== undefined) query = query.where("projectId", req.body.projectId);
    if (req.body.scriptId !== undefined) query = query.where("scriptId", req.body.scriptId);
    const data = await query.select("id", "state", "reason", "filePath", "prompt");

    const result = await Promise.all(data.map(async (item: any) => {
      const hasFile = item.filePath ? await u.oss.fileExists(item.filePath) : false;
      const state = item.state === "已完成" && !hasFile ? "生成失败" : item.state;
      return {
        ...item,
        state,
        reason: item.state === "已完成" && !hasFile ? "分镜图片文件已丢失，请重新生成" : item.reason,
        src: hasFile ? await u.oss.getSmallImageUrl(item.filePath) : null,
      };
    }));
    res.status(200).send(success(result));
  },
);
