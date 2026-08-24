import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();
const MAX_FILE_BYTES = 70 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function parseDataUrl(value: string): { mime: string; ext: string; buffer: Buffer } {
  const match = String(value || "").trim().match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("上传文件格式无效，请重新选择文件");
  const mime = match[1].toLowerCase();
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error(`不支持的文件格式：${mime}`);
  const compact = match[2].replace(/\s+/g, "");
  if (!compact || compact.length % 4 === 1) throw new Error("上传文件 Base64 数据无效");
  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length) throw new Error("上传文件为空");
  if (buffer.length > MAX_FILE_BYTES) throw new Error("单个素材文件不能超过 70MB");
  return { mime, ext, buffer };
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    base64Data: z.string().min(1),
    type: z.literal("clip").optional().default("clip"),
    name: z.string().trim().min(1).max(255),
  }),
  async (req, res, next) => {
    let savePath = "";
    try {
      const projectId = Number(req.body.projectId);
      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) return res.status(404).send(error("项目不存在"));

      const { mime, ext, buffer } = parseDataUrl(req.body.base64Data);
      savePath = `${projectId}/assets/clip/${u.uuid()}.${ext}`;
      await u.oss.writeFile(savePath, buffer);

      const result = await u.db.transaction(async (trx: any) => {
        const [rawId] = await trx("o_assets").insert({
          type: "clip",
          projectId,
          name: String(req.body.name).trim(),
          startTime: Date.now(),
        });
        const id = Number(rawId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error("创建素材失败：未获得素材编号");

        const [rawImageId] = await trx("o_image").insert({
          filePath: savePath,
          type: "clip",
          assetsId: id,
          state: "已完成",
          errorReason: null,
        });
        const imageId = Number(rawImageId);
        const affected = await trx("o_assets").where({ id, projectId }).update({ imageId });
        if (affected !== 1) throw new Error("素材文件绑定失败");
        return { id, imageId };
      });

      let url = "";
      try { url = await u.oss.getFileUrl(savePath); }
      catch (exception) { console.warn(`[assets] 上传成功但生成访问 URL 失败：${savePath}`, exception); }
      savePath = ""; // 数据库已提交，后续异常不能再删除文件。
      return res.status(200).send(success({ ...result, mime, url }, "上传成功"));
    } catch (exception) {
      if (savePath) await u.oss.deleteFile(savePath).catch(() => undefined);
      next(exception);
    }
  },
);
