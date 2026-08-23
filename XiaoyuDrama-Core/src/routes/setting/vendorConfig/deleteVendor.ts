import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";

const router = express.Router();
const vendorIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, "供应商 id 格式无效");

export default router.post(
  "/",
  validateFields({ id: vendorIdSchema }),
  async (req, res) => {
    try {
      const { id } = req.body;
      const existing = await u.db("o_vendorConfig").where("id", id).first("id");
      if (!existing) return res.status(404).send(error("供应商不存在"));
      await u.db.transaction(async (trx: any) => {
        await trx("o_vendorConfig").where("id", id).del();
        await trx("o_agentDeploy").where("vendorId", id).update({ model: null, modelName: null, vendorId: null });
      });
      u.vendor.deleteCode(id);
      res.status(200).send(success("删除成功"));
    } catch (exception) {
      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception)));
    }
  },
);
