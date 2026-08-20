import type { Express } from "express";
import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { XIAOYU_BRAND, type XiaoyuQualityMode } from "./brand";
import {
  estimateProduction,
  getProductionPolicy,
  getSelectedPolicyVersion,
  getSelectedQualityMode,
  getXiaoyuAccount,
  getXiaoyuQualityModes,
  hasXiaoyuCredential,
  loginXiaoyu,
  logoutXiaoyu,
  selectQualityMode,
  setProjectQualityContext,
  type XiaoyuEstimateItem,
} from "./computeCenterClient";

function sendFailure(res: express.Response, exception: unknown): void {
  const message = exception instanceof Error ? exception.message : String(exception);
  // 不返回 401：401 由 ToonFlow 本地登录态专用，避免智算中心账号错误导致客户端被强制退出。
  const status = /余额不足|充值/.test(message)
    ? 402
    : /超时|网络|连接/.test(message)
      ? 503
      : /策略版本不存在|暂不可生产|请求内容不一致/.test(message)
        ? 409
        : 400;
  res.status(status).send(error(message, { supportWechat: XIAOYU_BRAND.supportWechat }));
}

function isQualityMode(value: string): value is XiaoyuQualityMode {
  return (["quality", "standard", "economy"] as string[]).includes(value);
}

export default async function buildXiaoyuRoutes(app: Express): Promise<void> {
  const router = express.Router();

  router.get("/brand", (_, res) => {
    res.send(success(XIAOYU_BRAND));
  });

  router.get("/status", async (_, res) => {
    try {
      const loggedIn = await hasXiaoyuCredential();
      if (!loggedIn) {
        res.send(success({ loggedIn: false, supportWechat: XIAOYU_BRAND.supportWechat }));
        return;
      }
      const [account, qualityMode, policyVersion] = await Promise.all([
        getXiaoyuAccount(),
        getSelectedQualityMode(),
        getSelectedPolicyVersion(),
      ]);
      res.send(
        success({
          loggedIn: true,
          account,
          qualityMode,
          policyVersion,
          supportWechat: XIAOYU_BRAND.supportWechat,
        }),
      );
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.post("/login", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || password.length < 8) {
      res.status(400).send(error("请输入正确的账号和密码"));
      return;
    }
    try {
      const account = await loginXiaoyu(username, password);
      const modes = await getXiaoyuQualityModes();
      const qualityMode = await getSelectedQualityMode();
      const policyVersion = await getSelectedPolicyVersion();
      res.send(
        success(
          { account, modes, qualityMode, policyVersion, supportWechat: XIAOYU_BRAND.supportWechat },
          "登录成功",
        ),
      );
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.post("/logout", async (_, res) => {
    try {
      await logoutXiaoyu();
      res.send(success(null, "已退出小鱼智算中心，当前设备 Token 已撤销"));
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.get("/account", async (_, res) => {
    try {
      res.send(success(await getXiaoyuAccount()));
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.get("/quality-modes", async (_, res) => {
    try {
      res.send(
        success({
          modes: await getXiaoyuQualityModes(),
          selected: await getSelectedQualityMode(),
          policyVersion: await getSelectedPolicyVersion(),
        }),
      );
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.post("/quality-mode", async (req, res) => {
    const mode = String(req.body?.mode || "");
    if (!isQualityMode(mode)) {
      res.status(400).send(error("无效的质量模式"));
      return;
    }
    try {
      const selected = await selectQualityMode(mode);
      res.send(
        success(
          { selected: mode, policyVersion: selected.strategy_version, mode: selected },
          "质量模式已切换，新项目将锁定该生产策略；旧项目保持原策略不变",
        ),
      );
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.get("/policy/:mode", async (req, res) => {
    const mode = String(req.params.mode || "");
    if (!isQualityMode(mode)) {
      res.status(400).send(error("无效的质量模式"));
      return;
    }
    try {
      const version = req.query.version ? String(req.query.version) : undefined;
      res.send(success(await getProductionPolicy(mode, version)));
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.post("/estimate", async (req, res) => {
    const mode = String(req.body?.mode || req.body?.qualityMode || "");
    if (!isQualityMode(mode)) {
      res.status(400).send(error("无效的质量模式"));
      return;
    }
    const items = Array.isArray(req.body?.items) ? (req.body.items as XiaoyuEstimateItem[]) : [];
    if (!items.length) {
      res.status(400).send(error("费用预估至少需要一个生产环节"));
      return;
    }
    try {
      res.send(success(await estimateProduction(mode, req.body?.policyVersion, items)));
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  router.post("/project-context", async (req, res) => {
    const projectId = Number(req.body?.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      res.status(400).send(error("无效的项目编号"));
      return;
    }
    try {
      const project = await u.db("o_project").where({ id: projectId }).first();
      if (!project) throw new Error("项目不存在");
      const mode = String(project.qualityMode || "");
      const version = String(project.computePresetVersion || "");
      if (!isQualityMode(mode) || !version) {
        throw new Error("该项目尚未锁定小鱼智算中心生产策略，请先编辑项目并选择质量模式");
      }
      const policy = await setProjectQualityContext(String(project.id), mode, version);
      if (policy.policy_version !== version) {
        await u.db("o_project").where({ id: project.id }).update({ computePresetVersion: policy.policy_version });
      }
      res.send(success({ projectId: project.id, qualityMode: mode, policyVersion: policy.policy_version }));
    } catch (exception) {
      sendFailure(res, exception);
    }
  });

  app.use("/api/xiaoyu/compute-center", router);
}
