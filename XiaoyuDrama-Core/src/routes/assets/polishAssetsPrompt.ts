import express from "express";
import u from "@/utils";
import delegate from "@/routes/assetsGenerate/polishAssetsPrompt";

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    if (req.method === "POST") {
      const body = (req.body || {}) as Record<string, any>;
      if (body.type === "props") body.type = "tool";
      if (!body.projectId) return res.status(400).send({ message: "缺少 projectId" });
      const project = await u.db("o_project").where({ id: Number(body.projectId) }).first("id");
      if (!project) return res.status(404).send({ message: "项目不存在" });
    }
    next();
  } catch (error) {
    next(error);
  }
});
router.use(delegate);

export default router;
