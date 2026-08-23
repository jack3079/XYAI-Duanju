import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import compressing from "compressing";
import u from "@/utils";
import { getVersion } from "@/utils/writeVersion";
import { xiaoyuLog } from "./logger";

const BACKUP_FORMAT = "xiaoyu-backup-v1";
const PRODUCT_ID = "xiaoyu-ai-drama";
const MUTABLE_ENTRIES = ["db2.sqlite", "oss", "skills", "vendor", "modelPrompt", "xiaoyu-credential.key"] as const;
const ACCEPTED_BACKUP_ENTRIES = new Set<string>([...MUTABLE_ENTRIES, "assets"]);
const MAX_BACKUP_ARCHIVE_BYTES = 1024 * 1024 * 1024 * 1024;

function sha256File(filename: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filename, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size = 0;
    do {
      size = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (size > 0) hash.update(buffer.subarray(0, size));
    } while (size > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function externalMaintenanceRoot(): string {
  try {
    if (typeof process.versions?.electron !== "undefined") {
      const { app } = require("electron");
      return path.join(app.getPath("documents"), "小鱼Ai短剧生成系统");
    }
  } catch {
    // non-Electron runtime
  }
  if (String(process.env.XIAOYU_DATA_DIR || "").trim()) {
    return path.join(u.getPath("maintenance"), "external");
  }
  return path.join(path.dirname(u.getPath()), "xiaoyu-ai-drama-maintenance");
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
}

async function sqliteSnapshot(target: string): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const escaped = target.replace(/'/g, "''");
  await (u.db as any).raw("PRAGMA wal_checkpoint(FULL)");
  await (u.db as any).raw(`VACUUM INTO '${escaped}'`);
}

function copyTree(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
}

function fileManifest(root: string): Array<{ path: string; size: number; sha256: string }> {
  const rows: Array<{ path: string; size: number; sha256: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) rows.push({ path: path.relative(root, full).replace(/\\/g, "/"), size: fs.statSync(full).size, sha256: sha256File(full) });
    }
  };
  walk(root);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export interface BackupResult {
  file: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export async function createXiaoyuBackup(): Promise<BackupResult> {
  const root = externalMaintenanceRoot();
  const backups = path.join(root, "备份");
  const work = path.join(root, ".work", `backup-${crypto.randomUUID()}`);
  const payload = path.join(work, "payload");
  fs.mkdirSync(payload, { recursive: true });
  try {
    await sqliteSnapshot(path.join(payload, "db2.sqlite"));
    for (const entry of MUTABLE_ENTRIES) {
      if (entry === "db2.sqlite") continue;
      copyTree(u.getPath(entry), path.join(payload, entry));
    }
    const integrity = await (u.db as any).raw("PRAGMA integrity_check");
    const manifest = {
      format: BACKUP_FORMAT,
      productId: PRODUCT_ID,
      productName: "小鱼Ai短剧生成系统",
      appVersion: String(await getVersion()).trim(),
      createdAt: new Date().toISOString(),
      databaseIntegrity: integrity,
      entries: MUTABLE_ENTRIES,
      files: fileManifest(payload),
    };
    fs.writeFileSync(path.join(payload, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    fs.mkdirSync(backups, { recursive: true });
    const destination = path.join(backups, `小鱼Ai短剧生成系统-备份-${safeTimestamp()}.zip`);
    await compressing.zip.compressDir(payload, destination);
    const result = { file: destination, size: fs.statSync(destination).size, sha256: sha256File(destination), createdAt: manifest.createdAt };
    xiaoyuLog("info", "backup.created", result);
    return result;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function findManifestRoot(extracted: string): string {
  const candidates = [extracted, ...fs.readdirSync(extracted, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => path.join(extracted, item.name))];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "manifest.json"))) return candidate;
  }
  throw new Error("备份包缺少 manifest.json");
}

function verifySqliteSnapshot(filename: string): void {
  const Database = require("better-sqlite3");
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma("integrity_check");
    const values = Array.isArray(rows) ? rows.map((row: any) => String(Object.values(row)[0] || "")) : [String(rows || "")];
    if (!values.length || values.some((value: string) => value.toLowerCase() !== "ok")) throw new Error(`数据库完整性检查失败：${values.join("; ")}`);
  } finally {
    db.close();
  }
}

function verifyExtractedBackup(root: string): any {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (manifest.format !== BACKUP_FORMAT || manifest.productId !== PRODUCT_ID) throw new Error("不是有效的小鱼短剧备份包");
  if (!Array.isArray(manifest.files)) throw new Error("备份清单损坏");
  if (!Array.isArray(manifest.entries) || manifest.entries.some((entry: unknown) => !ACCEPTED_BACKUP_ENTRIES.has(String(entry)))) throw new Error("备份入口清单无效");
  for (const row of manifest.files) {
    const relative = String(row.path || "");
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("备份包包含非法路径");
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`备份文件缺失：${relative}`);
    if (fs.statSync(resolved).size !== Number(row.size) || sha256File(resolved) !== row.sha256) throw new Error(`备份文件校验失败：${relative}`);
  }
  const database = path.join(root, "db2.sqlite");
  if (!fs.existsSync(database)) throw new Error("备份包缺少数据库快照");
  verifySqliteSnapshot(database);
  return manifest;
}

export async function prepareXiaoyuRestore(backupFile: string): Promise<{ restartRequired: true; backupCreated: BackupResult; sourceVersion: string }> {
  const absolute = path.resolve(backupFile);
  if (!fs.existsSync(absolute) || path.extname(absolute).toLowerCase() !== ".zip") throw new Error("请选择有效的 .zip 备份文件");
  const archiveStat = fs.statSync(absolute);
  if (!archiveStat.isFile() || archiveStat.size <= 0 || archiveStat.size > MAX_BACKUP_ARCHIVE_BYTES) throw new Error("备份包大小无效或超过 1TB 安全上限");
  const currentBackup = await createXiaoyuBackup();
  const maintenance = String(process.env.XIAOYU_DATA_DIR || "").trim()
    ? u.getPath("maintenance")
    : path.join(path.dirname(u.getPath()), "xiaoyu-maintenance");
  const restoreId = crypto.randomUUID();
  const extractRoot = path.join(maintenance, "restore-stage", restoreId, "extract");
  fs.mkdirSync(extractRoot, { recursive: true });
  await compressing.zip.uncompress(absolute, extractRoot);
  const payloadRoot = findManifestRoot(extractRoot);
  const manifest = verifyExtractedBackup(payloadRoot);
  const pending = {
    format: "xiaoyu-restore-v1",
    restoreId,
    payloadRoot,
    preparedAt: new Date().toISOString(),
    sourceVersion: manifest.appVersion,
    safetyBackup: currentBackup.file,
  };
  fs.mkdirSync(maintenance, { recursive: true });
  const pendingFile = path.join(maintenance, "pending-restore.json");
  fs.writeFileSync(`${pendingFile}.tmp`, JSON.stringify(pending, null, 2), "utf-8");
  fs.renameSync(`${pendingFile}.tmp`, pendingFile);
  xiaoyuLog("warn", "restore.prepared", { sourceVersion: manifest.appVersion, safetyBackup: currentBackup.file });
  return { restartRequired: true, backupCreated: currentBackup, sourceVersion: String(manifest.appVersion || "") };
}

export function listXiaoyuBackups(): BackupResult[] {
  const backups = path.join(externalMaintenanceRoot(), "备份");
  if (!fs.existsSync(backups)) return [];
  return fs.readdirSync(backups)
    .filter((name) => name.toLowerCase().endsWith(".zip"))
    .map((name) => {
      const file = path.join(backups, name);
      const stat = fs.statSync(file);
      return { file, size: stat.size, sha256: "", createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getMaintenanceExternalRoot(): string {
  const root = externalMaintenanceRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}
