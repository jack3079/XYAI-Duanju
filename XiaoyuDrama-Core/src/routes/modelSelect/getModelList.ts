import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ type: z.enum(["text", "image", "video", "all"]) }),
  async (req, res) => {
    const { type } = req.body;
    const vendors = await u.db("o_vendorConfig").select("id").where("enable", 1);
    const result: Array<{ id: string; label: string; value: string; type: string; name: string }> = [];

    for (const row of vendors || []) {
      const id = String(row.id || "");
      if (!id) continue;
      try {
        const vendor = u.vendor.getVendor(id);
        const models = await u.vendor.getModelList(id);
        const filtered = type === "all" ? models : models.filter((item: any) => item?.type === type);
        for (const item of filtered) {
          const modelName = String(item?.modelName || "").trim();
          if (!modelName) continue;
          result.push({
            id,
            label: String(item?.name || modelName),
            value: modelName,
            type: String(item?.type || ""),
            name: String(vendor?.name || id),
          });
        }
      } catch (exception) {
        console.warn(`[modelSelect] 跳过不可用供应商 ${id}:`, exception);
      }
    }

    res.status(200).send(success(result));
  },
);
