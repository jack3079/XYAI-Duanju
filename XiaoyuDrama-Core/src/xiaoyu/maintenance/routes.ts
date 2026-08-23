import express from "express";
import fs from "node:fs";
import path from "node:path";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { createXiaoyuBackup, getMaintenanceExternalRoot, listXiaoyuBackups, prepareXiaoyuRestore } from "./backup";
import { createXiaoyuDiagnostics } from "./diagnostics";
import { checkXiaoyuUpdate, downloadXiaoyuUpdate, installXiaoyuUpdate, type SignedReleaseManifest } from "./update";
import { xiaoyuLog } from "./logger";
import { inspectXiaoyuProductionResources } from "./resourceGuard";

function isAllowedMaintenanceFile(file: string): boolean {
  const resolved = path.resolve(file);
  const roots = [path.resolve(getMaintenanceExternalRoot()), path.resolve(u.getPath("maintenance"))];
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}
function fail(res: express.Response, exception: unknown): void {
  const message = exception instanceof Error ? exception.message : String(exception);
  xiaoyuLog("error", "maintenance.route.failed", { message });
  res.status(400).send(error(message, { supportWechat: "echo169369" }));
}
export function createXiaoyuMaintenanceRouter(): any {
  const router = express.Router();
  router.get("/status", async (_, res) => {
    try {
      let integrity: unknown = null;
      try { const u = (await import("@/utils")).default; integrity = await (u.db as any).raw("PRAGMA integrity_check"); }
      catch (exception: any) { integrity = { error: exception.message }; }
      res.send(success({ root: getMaintenanceExternalRoot(), backups: listXiaoyuBackups().slice(0, 10), databaseIntegrity: integrity, supportWechat: "echo169369" }));
    } catch (exception) { fail(res, exception); }
  });
  router.post("/resources/check", async (req, res) => {
    try { res.send(success(await inspectXiaoyuProductionResources({ qualityMode: String(req.body?.qualityMode || "standard"), episodeCount: Number(req.body?.episodeCount || 1), shotsPerEpisode: Number(req.body?.shotsPerEpisode || 8), enableVoice: req.body?.enableVoice !== false, enableMusic: Boolean(req.body?.enableMusic) }))); }
    catch (exception) { fail(res, exception); }
  });
  router.post("/backup", async (_, res) => { try { res.send(success(await createXiaoyuBackup(), "备份完成")); } catch (exception) { fail(res, exception); } });
  router.get("/download", (req, res) => {
    try {
      const file = String(req.query.file || "");
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("下载文件不存在");
      if (!isAllowedMaintenanceFile(file)) throw new Error("只能下载小鱼维护目录中的文件");
      if (path.extname(file).toLowerCase() !== ".zip") throw new Error("仅允许下载小鱼备份/诊断 ZIP 文件");
      res.download(file, path.basename(file));
    } catch (exception) { fail(res, exception); }
  });
  router.post("/diagnostics", async (_, res) => { try { res.send(success(await createXiaoyuDiagnostics(), "诊断包已生成")); } catch (exception) { fail(res, exception); } });
  router.post("/restore/select", async (_, res) => {
    try {
      if (typeof process.versions?.electron === "undefined") throw new Error("只能在桌面客户端选择备份文件");
      const { dialog } = require("electron");
      const result = await dialog.showOpenDialog({ title: "选择小鱼短剧备份包", properties: ["openFile"], filters: [{ name: "小鱼备份", extensions: ["zip"] }] });
      res.send(success({ cancelled: result.canceled, file: result.canceled ? "" : result.filePaths[0] || "" }));
    } catch (exception) { fail(res, exception); }
  });
  router.post("/restore/prepare", async (req, res) => {
    try {
      if (typeof process.versions?.electron === "undefined") throw new Error("Docker/服务端模式当前支持创建和下载备份，但不支持应用内恢复；请使用持久化 volume 快照恢复，避免运行中的 SQLite 数据被覆盖");
      res.send(success(await prepareXiaoyuRestore(String(req.body?.file || "")), "恢复已准备，重启后生效"));
    } catch (exception) { fail(res, exception); }
  });
  router.post("/show-file", async (req, res) => {
    try {
      const file = String(req.body?.file || "");
      if (!file || !fs.existsSync(file)) throw new Error("文件不存在");
      if (!isAllowedMaintenanceFile(file)) throw new Error("只能打开小鱼维护目录中的文件");
      if (typeof process.versions?.electron === "undefined") throw new Error("只能在桌面客户端打开文件位置");
      const { shell } = require("electron"); shell.showItemInFolder(file); res.send(success(null));
    } catch (exception) { fail(res, exception); }
  });
  router.get("/update/check", async (req, res) => { try { res.send(success(await checkXiaoyuUpdate(String(req.query.channel || "stable")))); } catch (exception) { fail(res, exception); } });
  router.post("/update/download", async (req, res) => { try { res.send(success(await downloadXiaoyuUpdate(req.body?.manifest as SignedReleaseManifest), "更新包下载并校验完成")); } catch (exception) { fail(res, exception); } });
  router.post("/update/install", async (req, res) => { try { res.send(success(await installXiaoyuUpdate(req.body?.manifest as SignedReleaseManifest, String(req.body?.file || "")), "更新安装已启动")); } catch (exception) { fail(res, exception); } });
  return router;
}
