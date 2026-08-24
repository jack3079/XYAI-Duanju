import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { deleteLocalAssetFiles, normalizeStoredAssetPath } from "@/utils/audioAssetFiles";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ id: z.number().int().positive() }),
  async (req, res, next) => {
    try {
      const id = Number(req.body.id);
      const image = await u.db("o_image").where({ id }).first("id", "filePath", "state", "assetsId");
      if (!image) return res.status(404).send(error("图片记录不存在或已删除"));
      if (String(image.state || "") === "生成中") {
        return res.status(409).send(error("图片仍在生成中，请等待任务结束后再删除"));
      }

      const filePath = normalizeStoredAssetPath(image.filePath);
      const detached = await u.db.transaction(async (trx: any) => {
        const refs = await trx("o_assets").where({ imageId: id }).select("id");
        if (refs.length) await trx("o_assets").where({ imageId: id }).update({ imageId: null });
        const deleted = await trx("o_image").where({ id }).delete();
        if (deleted !== 1) throw Object.assign(new Error("图片记录已变化，请刷新后重试"), { status: 409 });
        return refs.length;
      });

      const cleanupWarnings = filePath ? await deleteLocalAssetFiles([filePath]) : 0;
      return res.status(200).send(success({ id, detachedAssets: detached, cleanupWarnings }, "资产图片删除成功"));
    } catch (exception) {
      next(exception);
    }
  },
);
