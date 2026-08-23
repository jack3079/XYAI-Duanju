import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    url: z.string().trim().min(1).max(10000),
    flowId: z.number().int().nonnegative(),
    projectId: z.number().int().positive().optional(),
    scriptId: z.number().int().positive().optional(),
  }),
  async (req, res) => {
    try {
      const { id, url, flowId, projectId, scriptId } = req.body;
      let assetQuery = u.db("o_assets").where({ id });
      if (projectId !== undefined) assetQuery = assetQuery.where({ projectId });
      if (scriptId !== undefined) assetQuery = assetQuery.andWhere((builder: any) => builder.whereNull("scriptId").orWhere("scriptId", scriptId));
      const asset = await assetQuery.first("id", "projectId", "scriptId", "imageId", "type");
      if (!asset) return res.status(404).send(error("资产不存在或不属于当前项目/剧集"));

      const filePath = u.replaceUrl(url);
      if (!filePath) return res.status(400).send(error("资产图片地址无效"));
      if (!(await u.oss.fileExists(filePath))) return res.status(400).send(error("资产图片文件不存在，请重新上传或生成"));

      const previousImageId = asset.imageId == null ? null : Number(asset.imageId);
      let imageId = previousImageId;
      await u.db.transaction(async (trx: any) => {
        if (imageId) {
          const affectedImage = await trx("o_image").where({ id: imageId }).update({
            filePath,
            state: "已完成",
            assetsId: id,
            type: asset.type || null,
            errorReason: null,
          });
          if (affectedImage !== 1) imageId = null;
        }
        if (!imageId) {
          const inserted = await trx("o_image").insert({
            filePath,
            state: "已完成",
            assetsId: id,
            type: asset.type || null,
            errorReason: null,
          });
          imageId = Number(inserted[0]);
        }
        const affectedAsset = await trx("o_assets").where({ id, projectId: asset.projectId }).update({ flowId, imageId });
        if (affectedAsset !== 1) throw new Error("资产记录已变化，请刷新后重试");
      });

      res.status(200).send(success({ message: "资产图片更新成功", imageId, filePath }));
    } catch (exception) {
      const status = Number((exception as any)?.status || 400);
      res.status(status >= 400 && status <= 599 ? status : 400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
