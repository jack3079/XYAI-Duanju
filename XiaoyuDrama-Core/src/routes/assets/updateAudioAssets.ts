import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { deleteLocalAssetFiles, normalizeStoredAssetPath, writeAudioDataUrl } from "@/utils/audioAssetFiles";

const router = express.Router();

function requestError(status: number, message: string): Error {
  const exception = new Error(message) as Error & { status?: number };
  exception.status = status;
  return exception;
}

const itemSchema = z.object({
  src: z.string().optional(),
  id: z.number().int().positive().optional(),
  base64: z.string().optional(),
  prompt: z.string().max(10000),
  describe: z.string().max(5000),
  name: z.string().trim().min(1).max(200),
});

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    describe: z.string().max(5000),
    projectId: z.number().int().positive(),
    assetsItem: z.array(itemSchema).max(100),
  }),
  async (req, res, next) => {
    const { id, name, describe, projectId, assetsItem } = req.body;
    const newFiles: string[] = [];
    const oldFilesToDelete: string[] = [];

    try {
      const parent = await u.db("o_assets").where({ id, projectId, type: "audio" }).first("id");
      if (!parent) throw requestError(404, "音频素材不存在或不属于当前项目");

      const children = await u.db("o_assets").where({ assetsId: id, projectId, type: "audio" }).select("id", "imageId");
      const childById = new Map(children.map((row: any) => [Number(row.id), row]));
      const incomingIds = assetsItem.map((item: any) => Number(item.id || 0)).filter((value: number) => value > 0);
      if (new Set(incomingIds).size !== incomingIds.length) throw requestError(400, "音频子项包含重复 id");
      const foreignIds = incomingIds.filter((childId: number) => !childById.has(childId));
      if (foreignIds.length) throw requestError(400, `以下音频子项不属于当前素材：${foreignIds.join("、")}`);

      const imageIds = children.map((row: any) => Number(row.imageId || 0)).filter((value: number) => value > 0);
      const imageRows = imageIds.length
        ? await u.db("o_image").whereIn("id", imageIds).select("id", "filePath", "assetsId")
        : [];
      const imageById = new Map(imageRows.map((row: any) => [Number(row.id), row]));

      const prepared = [] as Array<any>;
      for (const item of assetsItem) {
        const childId = item.id ? Number(item.id) : 0;
        let filePath = "";
        let oldFilePath = "";
        let imageId = 0;

        if (childId) {
          const child = childById.get(childId);
          imageId = Number(child?.imageId || 0);
          oldFilePath = normalizeStoredAssetPath(imageById.get(imageId)?.filePath);
          filePath = oldFilePath || normalizeStoredAssetPath(item.src);
        }

        if (item.base64) {
          const written = await writeAudioDataUrl(projectId, item.base64);
          filePath = written.path;
          newFiles.push(written.path);
          if (oldFilePath && oldFilePath !== written.path) oldFilesToDelete.push(oldFilePath);
        } else if (!childId) {
          throw requestError(400, `新增音频子项“${item.name}”缺少音频文件`);
        }

        if (!filePath) throw requestError(400, `音频子项“${item.name}”没有可用文件，请重新上传`);
        prepared.push({ ...item, childId, imageId, filePath, oldFilePath });
      }

      const incomingIdSet = new Set(incomingIds);
      const removed = children.filter((row: any) => !incomingIdSet.has(Number(row.id)));
      const removedImageIds = removed.map((row: any) => Number(row.imageId || 0)).filter((value: number) => value > 0);
      for (const imageId of removedImageIds) {
        const file = normalizeStoredAssetPath(imageById.get(imageId)?.filePath);
        if (file) oldFilesToDelete.push(file);
      }

      const result = await u.db.transaction(async (trx: any) => {
        const parentAffected = await trx("o_assets").where({ id, projectId, type: "audio" }).update({ name, describe });
        if (parentAffected !== 1) throw requestError(409, "音频素材在保存期间已发生变化");

        if (removed.length) {
          const removedIds = removed.map((row: any) => Number(row.id));
          await trx("o_assets2Storyboard").whereIn("assetId", removedIds).delete();
          await trx("o_scriptAssets").whereIn("assetId", removedIds).delete();
          await trx("o_assets").whereIn("id", removedIds).update({ imageId: null });
          if (removedImageIds.length) await trx("o_image").whereIn("id", removedImageIds).delete();
          await trx("o_assets").whereIn("id", removedIds).delete();
        }

        const childIds: number[] = [];
        for (const item of prepared) {
          if (item.childId) {
            const childAffected = await trx("o_assets").where({ id: item.childId, assetsId: id, projectId, type: "audio" }).update({
              prompt: item.prompt,
              describe: item.describe,
              name: item.name,
            });
            if (childAffected !== 1) throw requestError(409, `音频子项 ${item.childId} 在保存期间已发生变化`);

            if (item.imageId) {
              const imageAffected = await trx("o_image").where({ id: item.imageId, assetsId: item.childId }).update({
                filePath: item.filePath,
                type: "audio",
                state: "已完成",
                errorReason: null,
              });
              if (imageAffected !== 1) throw requestError(409, `音频子项 ${item.childId} 的文件记录不存在`);
            } else {
              const [imageIdRaw] = await trx("o_image").insert({
                filePath: item.filePath,
                type: "audio",
                assetsId: item.childId,
                state: "已完成",
                errorReason: null,
              });
              const linkAffected = await trx("o_assets").where({ id: item.childId, assetsId: id, projectId }).update({ imageId: Number(imageIdRaw) });
              if (linkAffected !== 1) throw requestError(409, `音频子项 ${item.childId} 文件绑定失败`);
            }
            childIds.push(item.childId);
            continue;
          }

          const [childIdRaw] = await trx("o_assets").insert({
            prompt: item.prompt,
            assetsId: id,
            type: "audio",
            projectId,
            describe: item.describe,
            name: item.name,
            startTime: Date.now(),
          });
          const childId = Number(childIdRaw);
          const [imageIdRaw] = await trx("o_image").insert({
            filePath: item.filePath,
            type: "audio",
            assetsId: childId,
            state: "已完成",
            errorReason: null,
          });
          const linkAffected = await trx("o_assets").where({ id: childId, assetsId: id, projectId }).update({ imageId: Number(imageIdRaw) });
          if (linkAffected !== 1) throw new Error(`音频子项 ${childId} 文件绑定失败`);
          childIds.push(childId);
        }
        return { id, childIds, removed: removed.length };
      });

      const cleanupWarnings = await deleteLocalAssetFiles(oldFilesToDelete.filter((file) => !newFiles.includes(file)));
      return res.status(200).send(success({ ...result, cleanupWarnings }, "更新音频素材成功"));
    } catch (exception) {
      await deleteLocalAssetFiles(newFiles);
      next(exception);
    }
  },
);
