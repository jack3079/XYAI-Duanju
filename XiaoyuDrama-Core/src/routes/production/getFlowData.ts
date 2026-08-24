import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

function parseObject(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

async function safePreview(filePath: unknown): Promise<string> {
  const value = String(filePath || "").trim();
  if (!value) return "";
  try { return await u.oss.getSmallImageUrl(value); }
  catch (exception) {
    console.warn(`[production] 预览图 URL 生成失败：${value}`, exception);
    return "";
  }
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    episodesId: z.number().int().positive(),
  }),
  async (req, res, next) => {
    try {
      const projectId = Number(req.body.projectId);
      const episodesId = Number(req.body.episodesId);
      const project = await u.db("o_project").where({ id: projectId }).first("id");
      if (!project) return res.status(404).send(error("项目不存在"));
      const script = await u.db("o_script").where({ id: episodesId, projectId }).first("id", "content");
      if (!script) return res.status(404).send(error("剧本不存在或不属于当前项目"));

      const workRow = await u.db("o_agentWorkData")
        .where({ projectId, episodesId, key: "productionAgent" })
        .orderBy("id", "desc")
        .first("id", "data");

      const scriptAssetRows = await u.db("o_scriptAssets").where({ scriptId: episodesId }).select("assetId");
      const assetIds = [...new Set(scriptAssetRows.map((row: any) => Number(row.assetId || 0)).filter((id: number) => id > 0))];

      const parents = assetIds.length
        ? await u.db("o_assets")
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .where("o_assets.projectId", projectId)
            .whereIn("o_assets.id", assetIds)
            .whereNull("o_assets.assetsId")
            .select("o_assets.*", "o_image.filePath", "o_image.state", "o_image.errorReason")
        : [];
      const children = assetIds.length
        ? await u.db("o_assets")
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .where("o_assets.projectId", projectId)
            .whereIn("o_assets.assetsId", assetIds)
            .whereNotNull("o_assets.assetsId")
            .select("o_assets.*", "o_image.filePath", "o_image.state", "o_image.errorReason")
        : [];

      const assets = await Promise.all(parents.map(async (item: any) => ({
        id: item.id,
        name: item.name ?? "",
        type: item.type ?? "",
        prompt: item.prompt ?? "",
        desc: item.describe ?? "",
        src: await safePreview(item.filePath),
        flowId: item.flowId,
        derive: await Promise.all(children
          .filter((child: any) => Number(child.assetsId) === Number(item.id))
          .map(async (child: any) => ({
            id: child.id,
            assetsId: item.id,
            name: child.name ?? "",
            type: child.type ?? "",
            prompt: child.prompt ?? "",
            desc: child.describe ?? "",
            src: await safePreview(child.filePath),
            state: child.state ?? "未生成",
            errorReason: child.errorReason ?? "",
            flowId: child.flowId,
          }))),
      })));

      const storyboardRows = await u.db("o_storyboard")
        .where({ scriptId: episodesId, projectId })
        .orderBy([{ column: "index", order: "asc" }, { column: "id", order: "asc" }]);
      const storyboardIds = storyboardRows.map((row: any) => Number(row.id || 0)).filter((id: number) => id > 0);
      const associations = storyboardIds.length
        ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).orderBy("rowid").select("storyboardId", "assetId")
        : [];
      const associationMap = new Map<number, number[]>();
      for (const row of associations as any[]) {
        const storyboardId = Number(row.storyboardId || 0);
        const assetId = Number(row.assetId || 0);
        if (!storyboardId || !assetId) continue;
        if (!associationMap.has(storyboardId)) associationMap.set(storyboardId, []);
        associationMap.get(storyboardId)!.push(assetId);
      }

      const storyboard = await Promise.all(storyboardRows.map(async (row: any) => ({
        id: row.id,
        index: row.index,
        duration: row.duration ? Number(row.duration) : 0,
        prompt: row.prompt ?? "",
        associateAssetsIds: associationMap.get(Number(row.id)) ?? [],
        src: await safePreview(row.filePath),
        state: row.state,
        videoDesc: row.videoDesc,
        shouldGenerateImage: row.shouldGenerateImage,
        reason: row.reason ?? "",
        flowId: row.flowId,
      })));

      const stored = parseObject(workRow?.data);
      const flowData: Record<string, any> = {
        ...stored,
        script: String(script.content || ""),
        scriptPlan: String(stored.scriptPlan || ""),
        assets,
        storyboardTable: String(stored.storyboardTable || ""),
        storyboard,
        workbench: stored.workbench && typeof stored.workbench === "object" ? stored.workbench : { videoList: [] },
      };
      return res.status(200).send(success(flowData));
    } catch (exception) {
      next(exception);
    }
  },
);
