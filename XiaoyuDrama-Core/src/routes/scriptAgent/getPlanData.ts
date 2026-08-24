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

function parsePlanData(value: unknown): { storySkeleton: string; adaptationStrategy: string } {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return {
      storySkeleton: String((parsed as any).storySkeleton || ""),
      adaptationStrategy: String((parsed as any).adaptationStrategy || ""),
    };
  } catch {
    return { storySkeleton: "", adaptationStrategy: "" };
  }
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    agentType: z.literal("scriptAgent"),
  }),
  async (req, res, next) => {
    try {
      const { projectId, agentType } = req.body;
      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) throw requestError(404, `项目不存在：${projectId}`);

      let row = await u.db("o_agentWorkData").where({ projectId, key: agentType }).orderBy("id", "asc").first();
      if (!row) {
        const now = Date.now();
        const [id] = await u.db("o_agentWorkData").insert({
          projectId,
          key: agentType,
          data: JSON.stringify({ storySkeleton: "", adaptationStrategy: "" }),
          createTime: now,
          updateTime: now,
        });
        row = await u.db("o_agentWorkData").where({ id }).first();
      }

      const plan = parsePlanData(row?.data);
      const canonicalData = JSON.stringify(plan);
      if (row?.id && String(row.data || "") !== canonicalData) {
        await u.db("o_agentWorkData").where({ id: row.id }).update({ data: canonicalData, updateTime: Date.now() });
      }

      const script = await u.db("o_script").where({ projectId }).orderBy("id", "asc").select("id", "name", "content");
      res.status(200).send(success({
        data: { ...plan, script },
        id: row?.id,
      }));
    } catch (error) {
      next(error);
    }
  },
);
