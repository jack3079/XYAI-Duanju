import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number().int().positive()).max(200),
    projectId: z.number().int().positive().optional(),
    scriptId: z.number().int().positive().optional(),
  }),
  async (req, res) => {
    const ids = [...new Set<number>(req.body.ids)];
    if (!ids.length) return res.status(200).send(success([]));
    if (ids.length !== req.body.ids.length) return res.status(400).send(error("轮询资产列表包含重复 id"));

    let query = u.db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .whereIn("o_assets.id", ids)
      .whereNot("o_image.state", "生成中");
    if (req.body.projectId !== undefined) query = query.where("o_assets.projectId", req.body.projectId);
    if (req.body.scriptId !== undefined) query = query.andWhere((builder: any) => builder.whereNull("o_assets.scriptId").orWhere("o_assets.scriptId", req.body.scriptId));

    const data = await query.select(
      "o_image.state",
      "o_assets.id",
      "o_image.filePath",
      "o_image.errorReason",
      "o_assets.prompt",
    );
    const result = await Promise.all(data.map(async (item: any) => {
      const hasFile = item.filePath ? await u.oss.fileExists(item.filePath) : false;
      const state = item.state === "已完成" && !hasFile ? "生成失败" : item.state;
      return {
        ...item,
        state,
        errorReason: item.state === "已完成" && !hasFile ? "图片文件已丢失，请重新生成" : item.errorReason,
        src: hasFile ? await u.oss.getSmallImageUrl(item.filePath) : null,
      };
    }));
    res.status(200).send(success(result));
  },
);
