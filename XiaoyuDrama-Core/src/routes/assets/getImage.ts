import express from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ assetsId: z.number().int().positive() }),
  async (req, res, next) => {
    try {
      const assetsId = Number(req.body.assetsId);
      const asset = await u.db("o_assets").where({ id: assetsId }).select("id", "imageId", "type", "projectId").first();
      if (!asset) return res.status(404).send(error("素材不存在或已删除"));

      const rawImages = await u.db("o_image")
        .where({ assetsId })
        .orderBy("id", "desc")
        .select("id", "filePath", "assetsId", "type", "state", "errorReason", "model", "resolution");

      const tempAssets = await Promise.all(rawImages.map(async (item: any) => {
        let filePath = "";
        if (item.filePath) {
          try { filePath = await u.oss.getSmallImageUrl(item.filePath); }
          catch (exception) { console.warn(`[assets] 图片 URL 生成失败：${item.id}`, exception); }
        }
        return {
          ...item,
          filePath,
          selected: asset.imageId != null && Number(item.id) === Number(asset.imageId),
        };
      }));

      return res.status(200).send(success({
        id: asset.id,
        projectId: asset.projectId,
        imageId: asset.imageId ?? null,
        type: asset.type,
        tempAssets,
      }));
    } catch (exception) {
      next(exception);
    }
  },
);
