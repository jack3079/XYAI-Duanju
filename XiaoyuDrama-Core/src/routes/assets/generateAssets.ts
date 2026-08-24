import express from "express";
import u from "@/utils";
import delegate from "@/routes/assetsGenerate/generateAssets";

const router = express.Router();
const QUALITY = new Set(["1K", "2K", "4K"]);

router.use(async (req, res, next) => {
  try {
    if (req.method === "POST") {
      const body = (req.body || {}) as Record<string, any>;
      const projectId = Number(body.projectId || 0);
      if (!projectId) return res.status(400).send({ message: "缺少 projectId" });
      const project = await u.db("o_project").where({ id: projectId }).first("id", "imageModel", "imageQuality");
      if (!project) return res.status(404).send({ message: "项目不存在" });
      if (body.type === "props") body.type = "tool";
      if (!body.model) body.model = String(project.imageModel || "").trim();
      if (!body.resolution) {
        const quality = String(project.imageQuality || "2K");
        body.resolution = QUALITY.has(quality) ? quality : "2K";
      }
      if (!String(body.model || "").trim()) {
        return res.status(400).send({ message: "请先在项目设置中选择图片模型" });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});
router.use(delegate);

export default router;
