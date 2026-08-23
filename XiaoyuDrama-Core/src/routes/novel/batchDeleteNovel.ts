import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number().int().positive()).min(1).max(500),
  }),
  async (req, res) => {
    const ids = [...new Set<number>(req.body.ids)];
    if (ids.length !== req.body.ids.length) return res.status(400).send(error("删除列表包含重复原文 id"));

    const novels = await u.db("o_novel").whereIn("id", ids).select("id");
    if (!novels.length) return res.status(404).send(error("未找到需要删除的原文"));
    const existingIds = novels.map((row: any) => Number(row.id));

    await u.db.transaction(async (trx: any) => {
      const chapters = await trx("o_eventChapter").whereIn("novelId", existingIds).select("eventId");
      const eventIds = [...new Set(chapters
        .map((row: any) => Number(row.eventId || 0))
        .filter((id: number) => Number.isSafeInteger(id) && id > 0))];

      await trx("o_eventChapter").whereIn("novelId", existingIds).delete();
      await trx("o_novel").whereIn("id", existingIds).delete();

      // event 可能被其他章节复用，只删除已经没有任何章节引用的事件。
      if (eventIds.length) {
        const referencedRows = await trx("o_eventChapter").whereIn("eventId", eventIds).distinct("eventId");
        const referenced = new Set(referencedRows.map((row: any) => Number(row.eventId)));
        const orphaned = eventIds.filter((eventId) => !referenced.has(eventId));
        if (orphaned.length) await trx("o_event").whereIn("id", orphaned).delete();
      }
    });

    res.status(200).send(success({ message: "删除原文成功", deleted: existingIds.length }));
  },
);
