import "./err";
import "./env";
import express, { Request, Response, NextFunction } from "express";
import { Server } from "socket.io";
import http from "node:http";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import path from "node:path";
import fs from "node:fs";
import u from "@/utils";
import jwt from "jsonwebtoken";
import socketInit from "@/socket/index";
import { isEletron } from "@/utils/getPath";
import { ensureThumbnail, ThumbnailSize } from "@/utils/image";
import { installXiaoyuProcessLogging, installXiaoyuRequestLogging } from "@/xiaoyu/maintenance/logger";
import buildXiaoyuRoutes from "@/xiaoyu/routes";
import { bootstrapXiaoyu } from "@/xiaoyu/bootstrap";
import { dbReady, db as rawDb } from "@/utils/db";
import { xiaoyuPipelineEngine } from "@/xiaoyu/pipeline/engine";

const app = express();
installXiaoyuProcessLogging();
const server = http.createServer(app);
let socketServer: Server | null = null;
let configured = false;
let shuttingDown = false;

async function checkPermissions() {
  if (!isEletron()) return true;
  const userDataPath = u.getPath();
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    const testFile = path.join(userDataPath, ".access_test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch {
    const { dialog, app: electronApp } = require("electron");
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "权限不足",
      message: "应用无法访问数据目录",
      detail: `无法读写以下目录：\n${userDataPath}\n\n请联系管理员授予权限，或以管理员身份运行本程序。`,
      buttons: ["确认退出"],
      defaultId: 0,
    });
    if (response === 0) electronApp.quit();
  }
  return true;
}

function resolveInside(rootDir: string, requestPath: string): { absolute: string; relative: string } | null {
  const relative = String(requestPath || "").replace(/^[/\\]+/, "");
  if (!relative) return null;
  const root = path.resolve(rootDir);
  const absolute = path.resolve(root, relative);
  const relation = path.relative(root, absolute);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) return null;
  return { absolute, relative: relation };
}

function parseThumbnailSize(value: unknown): { key: string; options: ThumbnailSize } | null {
  const size = String(value || "").trim();
  const dimensions = size.match(/^(\d+)x(\d+)$/i);
  if (dimensions) {
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (width < 16 || height < 16 || width > 4096 || height > 4096) return null;
    return { key: `${width}x${height}`, options: { type: "dimensions", width, height } };
  }
  const percent = size.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (percent) {
    const percentValue = Number(percent[1]);
    if (!Number.isFinite(percentValue) || percentValue < 1 || percentValue > 100) return null;
    return { key: `${String(percentValue).replace(".", "_")}p`, options: { type: "percentage", value: percentValue } };
  }
  return null;
}

async function configureApplication(): Promise<void> {
  if (configured) return;

  // dev 模式先生成 router.ts，再首次 import。旧逻辑先 import 再生成，新路由要重启第二次才生效。
  if (process.env.NODE_ENV === "dev") await buildRoute();
  const { default: routerDefault } = await import("@/router");

  expressWs(app);
  app.use(logger(process.env.NODE_ENV === "dev" ? "dev" : "combined"));
  app.get("/healthz", (_req, res) => res.status(200).send({ ok: true, service: "xiaoyu-ai-drama" }));
  app.get("/readyz", async (_req, res) => {
    try {
      await rawDb.raw("SELECT 1");
      res.status(200).send({ ok: true, ready: true, service: "xiaoyu-ai-drama" });
    } catch (error) {
      res.status(503).send({ ok: false, ready: false, message: u.error(error).message });
    }
  });

  installXiaoyuRequestLogging(app);
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  const ossDir = u.getPath("oss");
  fs.mkdirSync(ossDir, { recursive: true });
  app.use(
    "/oss",
    (req, res, next) => {
      if (!req.query.size) return next();
      const parsedSize = parseThumbnailSize(req.query.size);
      const original = resolveInside(ossDir, req.path);
      if (!parsedSize || !original) return express.static(ossDir, { acceptRanges: false })(req, res, next);

      const ext = path.extname(original.relative);
      const base = path.basename(original.relative, ext);
      const dir = path.dirname(original.relative);
      const thumbnailPath = path.join(ossDir, "smallImage", dir, `${base}_${parsedSize.key}${ext}`);
      const safeThumbnail = resolveInside(ossDir, path.relative(ossDir, thumbnailPath));
      if (!safeThumbnail) return res.status(400).send({ message: "缩略图路径无效" });

      void ensureThumbnail(original.absolute, safeThumbnail.absolute, parsedSize.options)
        .then((result) => {
          if (result) res.sendFile(result);
          else express.static(ossDir, { acceptRanges: false })(req, res, next);
        })
        .catch((error) => {
          console.warn("[thumbnail] 生成失败", u.error(error).message);
          express.static(ossDir, { acceptRanges: false })(req, res, next);
        });
    },
    express.static(ossDir, { acceptRanges: false }),
  );

  const skillsDir = u.getPath("skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  app.use(
    "/skills",
    (req, res, next) => (/\.(jpe?g|png|gif|webp|svg|ico|bmp)$/i.test(req.path) ? next() : res.status(403).end()),
    express.static(skillsDir, { acceptRanges: false }),
  );

  const assetsDir = u.getPath("assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  app.use("/assets", express.static(assetsDir, { acceptRanges: false }));

  const webDir = u.getPath("web");
  if (fs.existsSync(webDir)) app.use(express.static(webDir, { acceptRanges: false }));

  app.use(async (req, res, next) => {
    const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
    if (!setting) return res.status(503).send({ message: "服务器秘钥未配置，请联系管理员" });
    const tokenKey = String(setting.value || "");
    const rawToken = String(req.headers.authorization || req.query.token || "");
    const token = rawToken.replace(/^Bearer\s+/i, "");
    if (req.path === "/api/login/login") return next();
    if (!token) return res.status(401).send({ message: "未提供token" });
    try {
      (req as any).user = jwt.verify(token, tokenKey);
      next();
    } catch {
      return res.status(401).send({ message: "无效的token" });
    }
  });

  await buildXiaoyuRoutes(app);
  await routerDefault(app);

  app.use((_req, res) => res.status(404).send({ message: "API 404 Not Found" }));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const status = Number(err?.status || err?.statusCode || 500);
    const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    const message = safeStatus >= 500 ? "服务器内部错误" : String(err?.message || "请求失败");
    res.status(safeStatus).send({ message });
  });

  configured = true;
}

export default async function startServe(randomPort = false) {
  if (server.listening) {
    const address = server.address();
    return typeof address === "string" ? address : address?.port;
  }

  await checkPermissions();
  await dbReady;
  await u.writeVersion();
  await bootstrapXiaoyu();
  await configureApplication();

  if (!socketServer) {
    socketServer = new Server(server, {
      cors: { origin: "*" },
      pingInterval: 10000,
      pingTimeout: 60000,
    });
    socketInit(socketServer);
  }

  const port = randomPort ? 0 : Number(process.env.PORT || 10588);
  return new Promise<number | string | undefined>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", onError);
      const address = server.address();
      const realPort = typeof address === "string" ? address : address?.port;
      if (typeof realPort === "number") process.env.PORT = String(realPort);
      console.log(`[服务启动成功]: http://0.0.0.0:${realPort}`);
      resolve(realPort);
    });
  });
}

async function closeSocketServer(): Promise<void> {
  if (!socketServer) return;
  const current = socketServer;
  socketServer = null;
  await new Promise<void>((resolve) => current.close(() => resolve()));
}

export async function closeServe(): Promise<void> {
  await closeSocketServer().catch((error) => console.warn("[Socket关闭失败]", u.error(error).message));
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  console.log("[服务已关闭]");
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[系统退出] 收到 ${signal}，停止接收新任务`);
  const hardExit = setTimeout(() => {
    console.error("[系统退出] 优雅退出超时，强制结束进程");
    process.exit(1);
  }, 20_000);
  hardExit.unref();
  let fullyDrained = false;

  try {
    fullyDrained = await xiaoyuPipelineEngine.stop(10_000);
    await closeServe();
    if (fullyDrained) await rawDb.destroy();
    else console.warn("[系统退出] 仍有原子任务执行，保留数据库连接；lease 将在进程结束后自动过期恢复");
    process.exitCode = 0;
  } catch (error) {
    console.error("[系统退出] 关闭失败", error);
    process.exitCode = 1;
  } finally {
    // 未 drain 的任务由 20 秒 hard-exit 兜底，不能提前清掉定时器。
    if (fullyDrained) clearTimeout(hardExit);
  }
}

const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron) {
  process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
  startServe().catch(async (error) => {
    console.error("[服务启动失败]", error);
    await xiaoyuPipelineEngine.stop(0).catch(() => false);
    await rawDb.destroy().catch(() => undefined);
    process.exitCode = 1;
  });
}
