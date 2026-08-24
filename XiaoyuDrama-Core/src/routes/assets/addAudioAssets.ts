import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { deleteLocalAssetFiles, writeAudioDataUrl } from "@/utils/audioAssetFiles";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    name: z.string().trim().min(1).max(200),
    describe: z.string().max(5000),
    projectId: z.number().int().positive(),
    assetsItem: z.array(z.object({
      base64: z.string().min(1),
      prompt: z.string().max(10000),
      describe: z.string().max(5000),
      name: z.string().trim().min(1).max(200),
    })).min(1).max(100),
  }),
  async (req, res, next) => {
    const { name, describe, projectId, assetsItem } = req.body;
    const createdFiles: string[] = [];
    try {
      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) return res.status(404).send(error("项目不存在"));

      const prepared = [] as Array<any>;
      for (const item of assetsItem) {
        const file = await writeAudioDataUrl(projectId, item.base64);
        createdFiles.push(file.path);
        prepared.push({ ...item, filePath: file.path });
      }

      const result = await u.db.transaction(async (trx: any) => {
        const [parentIdRaw] = await trx("o_assets").insert({
          name,
          describe,
          type: "audio",
          projectId,
          startTime: Date.now(),
        });
        const parentId = Number(parentIdRaw);
        if (!Number.isSafeInteger(parentId) || parentId <= 0) throw new Error("创建音频素材失败：未获得素材编号");

        const childIds: number[] = [];
        for (const item of prepared) {
          const [childIdRaw] = await trx("o_assets").insert({
            prompt: item.prompt,
            assetsId: parentId,
            type: "audio",
            describe: item.describe,
            name: item.name,
            projectId,
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
          const imageId = Number(imageIdRaw);
          const affected = await trx("o_assets").where({ id: childId, assetsId: parentId, projectId }).update({ imageId });
          if (affected !== 1) throw new Error(`音频子素材 ${childId} 创建失败`);
          childIds.push(childId);
        }
        return { id: parentId, childIds };
      });

      return res.status(200).send(success(result, "新增音频素材成功"));
    } catch (exception) {
      await deleteLocalAssetFiles(createdFiles);
      next(exception);
    }
  },
);
