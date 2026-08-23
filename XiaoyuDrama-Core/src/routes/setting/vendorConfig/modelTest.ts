import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { ProviderTestError, testProviderModel } from "@/utils/providerModelTest";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");

export default router.post(
  "/",
  validateFields({
    modelName: z.string().trim().min(1),
    type: z.enum(["text", "video", "image"]),
    id: vendorIdSchema,
  }),
  async (req, res) => {
    const { modelName, type, id } = req.body;
    try {
      // 测试态允许 Provider 尚未启用，正式生产调用仍由 AI runtime 强制要求 enable=1。
      const result = await testProviderModel(id, modelName, type);
      if (result.type === "text") return res.status(200).send(success(result.text || "OK"));

      const suffix = `${Date.now()}_${u.uuid()}`;
      const ext = result.type === "video" ? "mp4" : "jpg";
      const file = `model-tests/${id}/model-test-${suffix}.${ext}`;
      await u.oss.writeFile(file, result.base64 || "");
      return res.status(200).send(success(await u.oss.getFileUrl(file)));
    } catch (exception) {
      console.error("[modelTest]", exception);
      const status = exception instanceof ProviderTestError ? exception.status : 500;
      const message = exception instanceof Error ? exception.message : String(exception);
      return res.status(status).send(error(message));
    }
  },
);
