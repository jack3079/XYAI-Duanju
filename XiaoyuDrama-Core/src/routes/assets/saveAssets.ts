import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

function parseImageBase64(value: string): { buffer: Buffer; ext: string } {
  const raw = String(value || "").trim();
  const payload = raw.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!payload || payload.length % 4 === 1) throw new Error("上传图片 Base64 数据无效");
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length) throw new Error("上传图片为空");
  if (buffer.length > 50 * 1024 * 1024) throw new Error("单张上传图片不能超过 50MB");

  let ext = "";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = "jpg";
  else if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = "png";
  else if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") ext = "webp";
  else if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) ext = "gif";
  if (!ext) throw new Error("仅支持 JPEG、PNG、WebP 或 GIF 图片");
  return { buffer, ext };
}

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    projectId: z.number().int().positive(),
    base64: z.string().optional().nullable(),
    // 兼容旧批量素材窗口：生成完成后会再次提交 filePath，但无需重复写文件。
    filePath: z.string().optional().nullable(),
    type: z.enum(["role", "scene", "tool", "props"]).optional(),
    prompt: z.string().optional().nullable(),
    imageId: z.number().int().positive().optional().nullable(),
  }),
  async (req, res, next) => {
    const { id, projectId } = req.body;
    const prompt = String(req.body.prompt || "");
    let newFilePath = "";
    let fileCommitted = false;

    try {
      const asset = await u.db("o_assets").where({ id, projectId }).first("id", "type", "imageId");
      if (!asset) return res.status(404).send(error("素材不存在或不属于当前项目"));

      // 旧批量窗口的确认动作只需要保存文字修改；图片在 generateAssets 中已经原子绑定。
      if (!req.body.base64 && req.body.filePath && req.body.imageId == null && req.body.type == null) {
        const affected = await u.db("o_assets").where({ id, projectId }).update({ prompt });
        if (affected !== 1) return res.status(409).send(error("素材已变化，请刷新后重试"));
        return res.status(200).send(success({ imageId: asset.imageId ?? null }, "批量素材已保存"));
      }

      if (!req.body.type) return res.status(400).send(error("缺少素材类型"));
      const type = req.body.type === "props" ? "tool" : req.body.type;
      if (String(asset.type || "") !== type && !(String(asset.type || "") === "props" && type === "tool")) {
        return res.status(400).send(error(`素材类型不匹配：当前为 ${asset.type || "未知"}`));
      }

      if (req.body.base64) {
        const { buffer, ext } = parseImageBase64(req.body.base64);
        newFilePath = `${projectId}/${type}/${uuidv4()}.${ext}`;
        await u.oss.writeFile(newFilePath, buffer);

        const result = await u.db.transaction(async (trx: any) => {
          const [imageIdRaw] = await trx("o_image").insert({
            assetsId: id,
            filePath: newFilePath,
            type,
            state: "已完成",
            errorReason: null,
          });
          const imageId = Number(imageIdRaw);
          const affected = await trx("o_assets").where({ id, projectId }).update({ prompt, imageId });
          if (affected !== 1) throw Object.assign(new Error("素材在保存期间已发生变化"), { status: 409 });
          return { imageId };
        });
        fileCommitted = true;

        let filePath = "";
        try { filePath = await u.oss.getFileUrl(newFilePath); }
        catch (exception) { console.warn(`[assets] 图片已保存但生成访问 URL 失败：${newFilePath}`, exception); }
        return res.status(200).send(success({ ...result, filePath }, "保存资产图片成功"));
      }

      const imageId = req.body.imageId == null ? null : Number(req.body.imageId);
      if (imageId !== null) {
        const image = await u.db("o_image").where({ id: imageId, assetsId: id }).first("id", "state");
        if (!image) return res.status(400).send(error("所选图片不属于当前素材或已被删除"));
        if (String(image.state || "") !== "已完成") return res.status(409).send(error("只能选择已完成的图片"));
      }

      const affected = await u.db("o_assets").where({ id, projectId }).update({ prompt, imageId });
      if (affected !== 1) return res.status(409).send(error("素材已变化，请刷新后重试"));
      return res.status(200).send(success({ imageId }, imageId === null ? "已清除当前素材图片" : "保存资产图片成功"));
    } catch (exception) {
      if (newFilePath && !fileCommitted) await u.oss.deleteFile(newFilePath).catch(() => undefined);
      next(exception);
    }
  },
);
