import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");

export default router.post(
  "/",
  validateFields({ modelName: z.string().trim().min(1), type: z.enum(["text", "video", "image"]), id: vendorIdSchema }),
  async (req, res) => {
    const { modelName, type, id } = req.body;
    try {
      const vendorConfig = await u.db("o_vendorConfig").where("id", id).first();
      if (!vendorConfig) return res.status(404).send(error("未找到该供应商配置"));

      const models = await u.vendor.getModelList(id);
      const selected = models.find((item: any) => String(item?.modelName) === modelName);
      if (!selected) return res.status(404).send(error(`未找到模型 ${modelName}`));
      if (String(selected.type) !== type) return res.status(400).send(error(`模型类型不匹配：期望 ${type}，实际 ${selected.type}`));

      if (type === "text") {
        // 连通性测试只验证基础文本生成，不强制 Tool Calling 能力。
        const result = await u.Ai.Text(`${id}:${modelName}`).invoke({ prompt: "请只回复：OK" });
        const text = String((result as any)?.text || "").trim();
        if (!text) return res.status(502).send(error("文本模型未返回内容"));
        return res.status(200).send(success(text));
      }

      const suffix = `${Date.now()}_${u.uuid()}`;
      if (type === "image") {
        const task = await u.Ai.Image(`${id}:${modelName}`).run({
          prompt: "一只橙色猫坐在窗边，柔和自然光，高清摄影风格",
          referenceList: [],
          size: "1K",
          aspectRatio: "16:9",
        });
        const file = `model-test-${suffix}.jpg`;
        await task.save(file);
        return res.status(200).send(success(await u.oss.getFileUrl(file)));
      }

      const maps = Array.isArray(selected.durationResolutionMap) ? selected.durationResolutionMap : [];
      const first = maps.find((item: any) => Array.isArray(item?.duration) && item.duration.length > 0 && Array.isArray(item?.resolution) && item.resolution.length > 0);
      if (!first) return res.status(400).send(error("视频模型缺少可用的 durationResolutionMap"));
      const task = await u.Ai.Video(`${id}:${modelName}`).run({
        duration: Number(first.duration[0]),
        resolution: String(first.resolution[0]),
        aspectRatio: "16:9",
        prompt: "A calm cinematic shot of a cat walking through a sunlit room.",
        referenceList: [],
        audio: false,
        mode: ["text"],
      });
      const file = `model-test-${suffix}.mp4`;
      await task.save(file);
      return res.status(200).send(success(await u.oss.getFileUrl(file)));
    } catch (exception) {
      console.error("[modelTest]", exception);
      return res.status(500).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
