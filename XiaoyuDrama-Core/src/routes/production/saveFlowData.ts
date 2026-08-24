import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

function requestError(status: number, message: string): Error {
  const exception = new Error(message) as Error & { status?: number };
  exception.status = status;
  return exception;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    episodesId: z.number().int().positive(),
    data: z.any(),
  }),
  async (req, res, next) => {
    try {
      const projectId = Number(req.body.projectId);
      const episodesId = Number(req.body.episodesId);
      const data = req.body.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(400).send(error("生产工作台数据格式无效"));

      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) return res.status(404).send(error("项目不存在"));
      const script = await u.db("o_script").where({ id: episodesId, projectId }).first("id");
      if (!script) return res.status(404).send(error("剧本不存在或不属于当前项目"));

      const storyboard = Array.isArray((data as any).storyboard) ? (data as any).storyboard : [];
      const storyboardIds = storyboard
        .map((item: any) => Number(item?.id || 0))
        .filter((id: number) => Number.isSafeInteger(id) && id > 0);
      if (new Set(storyboardIds).size !== storyboardIds.length) return res.status(400).send(error("分镜列表包含重复 id"));
      if (storyboardIds.length) {
        const existing = await u.db("o_storyboard")
          .where({ projectId, scriptId: episodesId })
          .whereIn("id", storyboardIds)
          .select("id");
        const existingSet = new Set(existing.map((row: any) => Number(row.id)));
        const foreign = storyboardIds.filter((id: number) => !existingSet.has(id));
        if (foreign.length) return res.status(400).send(error(`以下分镜不存在或不属于当前剧本：${foreign.join("、")}`));
      }

      const serialized = JSON.stringify(data);
      const now = Date.now();
      const result = await u.db.transaction(async (trx: any) => {
        let index = 0;
        for (const item of storyboard) {
          const id = Number(item?.id || 0);
          if (!id) continue;
          const affected = await trx("o_storyboard").where({ id, projectId, scriptId: episodesId }).update({ index });
          if (affected !== 1) throw requestError(409, `分镜 ${id} 在保存期间已变化`);
          index += 1;
        }

        const rows = await trx("o_agentWorkData")
          .where({ projectId, episodesId, key: "productionAgent" })
          .orderBy("id", "desc")
          .select("id");
        let id = Number(rows[0]?.id || 0);
        if (!id) {
          const inserted = await trx("o_agentWorkData").insert({
            projectId,
            episodesId,
            key: "productionAgent",
            data: serialized,
            createTime: now,
            updateTime: now,
          });
          id = Number(inserted[0]);
        } else {
          const affected = await trx("o_agentWorkData").where({ id, projectId, episodesId, key: "productionAgent" }).update({
            data: serialized,
            updateTime: now,
          });
          if (affected !== 1) throw requestError(409, "生产工作台数据已变化，请刷新后重试");
          const duplicateIds = rows.slice(1).map((row: any) => Number(row.id)).filter((value: number) => value > 0);
          if (duplicateIds.length) await trx("o_agentWorkData").whereIn("id", duplicateIds).delete();
        }
        return { id, storyboardCount: storyboardIds.length };
      });

      return res.status(200).send(success(result, "生产工作台已保存"));
    } catch (exception) {
      next(exception);
    }
  },
);
