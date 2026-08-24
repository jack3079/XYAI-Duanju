import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

function requestError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

async function collectAssetTree(trx: any, rootId: number): Promise<number[]> {
  const result = new Set<number>([rootId]);
  let frontier = [rootId];
  for (let depth = 0; frontier.length && depth < 64; depth += 1) {
    const rows = await trx("o_assets").whereIn("assetsId", frontier).select("id");
    const next: number[] = [];
    for (const row of rows) {
      const id = Number(row?.id || 0);
      if (!Number.isSafeInteger(id) || id <= 0 || result.has(id)) continue;
      result.add(id);
      next.push(id);
    }
    frontier = next;
  }
  return [...result];
}

export default router.post(
  "/",
  validateFields({ id: z.number().int().positive() }),
  async (req, res, next) => {
    try {
      const rootId = Number(req.body.id);
      const root = await u.db("o_assets").where({ id: rootId }).first("id");
      if (!root) throw requestError(404, `素材不存在：${rootId}`);

      const filePaths: string[] = [];
      const result = await u.db.transaction(async (trx: any) => {
        const assetIds = await collectAssetTree(trx, rootId);
        const assetRows = await trx("o_assets").whereIn("id", assetIds).select("id", "imageId");
        const referencedImageIds = assetRows
          .map((row: any) => Number(row?.imageId || 0))
          .filter((id: number) => Number.isSafeInteger(id) && id > 0);

        const imageByOwner = await trx("o_image").whereIn("assetsId", assetIds).select("id", "filePath", "assetsId");
        const ownerImageIds = imageByOwner
          .map((row: any) => Number(row?.id || 0))
          .filter((id: number) => Number.isSafeInteger(id) && id > 0);
        const candidateImageIds = [...new Set([...referencedImageIds, ...ownerImageIds])];

        let allCandidateImages: any[] = imageByOwner;
        if (referencedImageIds.length) {
          const referencedRows = await trx("o_image").whereIn("id", referencedImageIds).select("id", "filePath", "assetsId");
          const map = new Map<number, any>();
          for (const row of [...imageByOwner, ...referencedRows]) map.set(Number(row.id), row);
          allCandidateImages = [...map.values()];
        }

        let externallyReferenced = new Set<number>();
        if (candidateImageIds.length) {
          const outside = await trx("o_assets").whereNotIn("id", assetIds).whereIn("imageId", candidateImageIds).select("imageId");
          externallyReferenced = new Set(outside.map((row: any) => Number(row?.imageId || 0)).filter(Boolean));
        }
        const deleteImageIds = candidateImageIds.filter((imageId) => !externallyReferenced.has(imageId));
        const keepImageIds = candidateImageIds.filter((imageId) => externallyReferenced.has(imageId));

        await trx("o_assets2Storyboard").whereIn("assetId", assetIds).delete();
        await trx("o_scriptAssets").whereIn("assetId", assetIds).delete();
        await trx("o_assetsRole2Audio").whereIn("assetsRoleId", assetIds).delete();
        await trx("o_assetsRole2Audio").whereIn("assetsAudioId", assetIds).delete();
        await trx("o_assets").whereIn("id", assetIds).update({ imageId: null });

        if (keepImageIds.length) {
          await trx("o_image").whereIn("id", keepImageIds).whereIn("assetsId", assetIds).update({ assetsId: null });
        }
        if (deleteImageIds.length) await trx("o_image").whereIn("id", deleteImageIds).delete();
        await trx("o_assets").whereIn("id", assetIds).delete();

        const deletedImageSet = new Set(deleteImageIds);
        for (const row of allCandidateImages) {
          if (!deletedImageSet.has(Number(row?.id || 0))) continue;
          const filePath = String(row?.filePath || "").trim();
          if (filePath && !/^https?:\/\//i.test(filePath)) filePaths.push(filePath);
        }
        return { deletedAssets: assetIds.length, deletedImages: deleteImageIds.length };
      });

      let cleanupWarnings = 0;
      for (const filePath of [...new Set(filePaths)]) {
        try {
          await u.oss.deleteFile(filePath);
        } catch (error: any) {
          if (error?.code !== "ENOENT") {
            cleanupWarnings += 1;
            console.warn(`[assets] 数据已删除，但素材文件清理失败：${filePath}`, error);
          }
        }
      }

      res.status(200).send(success({ ...result, cleanupWarnings }, "删除素材成功"));
    } catch (error) {
      next(error);
    }
  },
);
