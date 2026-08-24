import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

function requestError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    data: z.object({
      storySkeleton: z.string(),
      adaptationStrategy: z.string(),
      // 前端历史版本会附带 script；剧本以 o_script 为唯一事实来源，这里只验证兼容、不重复持久化。
      script: z.array(z.object({
        id: z.number().int().positive().optional(),
        name: z.string().optional(),
        content: z.string(),
      })).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { id, data } = req.body;
      const row = await u.db("o_agentWorkData").where({ id }).first("id", "projectId", "key");
      if (!row) throw requestError(404, `Agent 工作数据不存在：${id}`);
      if (String(row.key || "") !== "scriptAgent") throw requestError(400, "该工作数据不属于编剧 Agent");

      const affected = await u.db("o_agentWorkData").where({ id }).update({
        data: JSON.stringify({
          storySkeleton: data.storySkeleton,
          adaptationStrategy: data.adaptationStrategy,
        }),
        updateTime: Date.now(),
      });
      if (affected !== 1) throw requestError(409, "Agent 工作数据已变化，请刷新后重试");
      res.status(200).send(success("更新成功"));
    } catch (error) {
      next(error);
    }
  },
);
