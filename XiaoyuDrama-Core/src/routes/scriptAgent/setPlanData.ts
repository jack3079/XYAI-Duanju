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

const scriptItemSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(200),
  content: z.string(),
});

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    agentType: z.literal("scriptAgent"),
    data: z.object({
      storySkeleton: z.string(),
      adaptationStrategy: z.string(),
      script: z.array(scriptItemSchema).max(500),
    }),
  }),
  async (req, res, next) => {
    try {
      const { projectId, agentType, data } = req.body;
      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) throw requestError(404, `项目不存在：${projectId}`);

      const normalizedScripts = data.script.map((item: any) => ({
        id: item.id ? Number(item.id) : undefined,
        name: String(item.name).trim(),
        content: String(item.content ?? ""),
      }));
      const ids = normalizedScripts.map((item: any) => item.id).filter(Boolean) as number[];
      if (new Set(ids).size !== ids.length) throw requestError(400, "剧本列表包含重复 id");
      const names = normalizedScripts.map((item: any) => item.name);
      if (new Set(names).size !== names.length) throw requestError(400, "剧本列表包含重复名称，请先合并或重命名");

      await u.db.transaction(async (trx: any) => {
        const now = Date.now();
        const workData = JSON.stringify({
          storySkeleton: data.storySkeleton,
          adaptationStrategy: data.adaptationStrategy,
        });
        const row = await trx("o_agentWorkData").where({ projectId, key: agentType }).first("id");
        if (row?.id) {
          await trx("o_agentWorkData").where({ id: row.id }).update({ data: workData, updateTime: now });
        } else {
          await trx("o_agentWorkData").insert({
            projectId,
            key: agentType,
            data: workData,
            createTime: now,
            updateTime: now,
          });
        }

        for (const item of normalizedScripts) {
          if (item.id) {
            const existing = await trx("o_script").where({ id: item.id, projectId }).first("id");
            if (!existing) throw requestError(400, `剧本 ${item.id} 不存在或不属于当前项目`);
            await trx("o_script").where({ id: item.id, projectId }).update({ name: item.name, content: item.content });
            continue;
          }

          const sameName = await trx("o_script").where({ projectId, name: item.name }).first("id");
          if (sameName?.id) {
            await trx("o_script").where({ id: sameName.id, projectId }).update({ content: item.content });
          } else {
            await trx("o_script").insert({ projectId, name: item.name, content: item.content });
          }
        }
      });

      const scripts = await u.db("o_script").where({ projectId }).orderBy("id", "asc").select("id", "name", "content");
      res.status(200).send(success({ script: scripts }, "保存成功"));
    } catch (error) {
      next(error);
    }
  },
);
