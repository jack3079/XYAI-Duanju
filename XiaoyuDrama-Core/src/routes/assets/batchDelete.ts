import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { deleteLocalAssetFiles, normalizeStoredAssetPath } from "@/utils/audioAssetFiles";

const router = express.Router();

async function collectAssetTrees(trx: any, roots: number[]): Promise<number[]> {
  const result = new Set<number>(roots);
  let frontier = [...roots];
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
  validateFields({ id: z.array(z.number().int().positive()).min(1).max(500) }),
  async (req, res, next) => {
    try {
      const rootIds = [...new Set((req.body.id as number[]).map(Number))];
      const existingRoots = await u.db("o_assets").whereIn("id", rootIds).select("id");
      const existingSet = new Set(existingRoots.map((row: any) => Number(row.id)));
      const missing = rootIds.filter((id) => !existingSet.has(id));
      if (missing.length) return res.status(404).send(error(`以下素材不存在：${missing.join("、")}`));

      const filePaths: string[] = [];
      const result = await u.db.transaction(async (trx: any) => {
        const assetIds = await collectAssetTrees(trx, rootIds);
        const assetRows = await trx("o_assets").whereIn("id", assetIds).select("id", "imageId");
        const referencedImageIds = assetRows.map((row: any) => Number(row.imageId || 0)).filter((id: number) => id > 0);
        const ownedImages = await trx("o_image").whereIn("assetsId", assetIds).select("id", "filePath", "assetsId");
        const ownedImageIds = ownedImages.map((row: any) => Number(row.id || 0)).filter((id: number) => id > 0);
        const candidateImageIds = [...new Set([...referencedImageIds, ...ownedImageIds])];

        const imageMap = new Map<number, any>();
        for (const row of ownedImages) imageMap.set(Number(row.id), row);
        if (referencedImageIds.length) {
          const rows = await trx("o_image").whereIn("id", referencedImageIds).select("id", "filePath", "assetsId");
          for (const row of rows) imageMap.set(Number(row.id), row);
        }

        const externalRefs = candidateImageIds.length
          ? await trx("o_assets").whereNotIn("id", assetIds).whereIn("imageId", candidateImageIds).select("imageId")
          : [];
        const externallyReferenced = new Set(externalRefs.map((row: any) => Number(row.imageId || 0)).filter(Boolean));
        const deleteImageIds = candidateImageIds.filter((id) => !externallyReferenced.has(id));
        const keepImageIds = candidateImageIds.filter((id) => externallyReferenced.has(id));

        await trx("o_assets2Storyboard").whereIn("assetId", assetIds).delete();
        await trx("o_scriptAssets").whereIn("assetId", assetIds).delete();
        await trx("o_assetsRole2Audio").whereIn("assetsRoleId", assetIds).delete();
        await trx("o_assetsRole2Audio").whereIn("assetsAudioId", assetIds).delete();
        await trx("o_assets").whereIn("id", assetIds).update({ imageId: null });

        if (keepImageIds.length) await trx("o_image").whereIn("id", keepImageIds).whereIn("assetsId", assetIds).update({ assetsId: null });
        if (deleteImageIds.length) await trx("o_image").whereIn("id", deleteImageIds).delete();
        const deletedAssets = await trx("o_assets").whereIn("id", assetIds).delete();

        for (const imageId of deleteImageIds) {
          const path = normalizeStoredAssetPath(imageMap.get(imageId)?.filePath);
          if (path) filePaths.push(path);
        }
        return { requested: rootIds.length, deletedAssets: Number(deletedAssets || 0), deletedImages: deleteImageIds.length };
      });

      const cleanupWarnings = await deleteLocalAssetFiles(filePaths);
      return res.status(200).send(success({ ...result, cleanupWarnings }, "批量删除素材成功"));
    } catch (exception) {
      next(exception);
    }
  },
);
