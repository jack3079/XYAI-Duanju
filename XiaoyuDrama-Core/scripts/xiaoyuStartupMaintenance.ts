import fs from "node:fs";
import path from "node:path";

const MUTABLE = ["db2.sqlite", "oss", "skills", "vendor", "modelPrompt", "xiaoyu-credential.key"];

function copyPath(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function safeRename(source: string, target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(source, target);
}

export function applyPendingXiaoyuRestore(userDataDir: string): void {
  const maintenance = path.join(userDataDir, "xiaoyu-maintenance");
  const pendingFile = path.join(maintenance, "pending-restore.json");
  if (!fs.existsSync(pendingFile)) return;
  const pending = JSON.parse(fs.readFileSync(pendingFile, "utf-8"));
  if (pending.format !== "xiaoyu-restore-v1") throw new Error("恢复任务格式无效");
  const payload = path.resolve(String(pending.payloadRoot || ""));
  const allowed = path.resolve(path.join(maintenance, "restore-stage"));
  if (!payload.startsWith(allowed + path.sep) || !fs.existsSync(path.join(payload, "manifest.json"))) throw new Error("恢复暂存目录不受信任");

  const dataDir = path.join(userDataDir, "data");
  const operationId = `${Date.now()}-${process.pid}`;
  const rollback = path.join(maintenance, "rollback", operationId);
  const applyStage = path.join(maintenance, "apply-stage", operationId);
  fs.mkdirSync(rollback, { recursive: true });
  fs.mkdirSync(applyStage, { recursive: true });

  for (const entry of MUTABLE) {
    const source = path.join(payload, entry);
    if (fs.existsSync(source)) copyPath(source, path.join(applyStage, entry));
  }

  const movedCurrent: string[] = [];
  const installedNew: string[] = [];
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const entry of MUTABLE) {
      const current = path.join(dataDir, entry);
      if (fs.existsSync(current)) {
        safeRename(current, path.join(rollback, entry));
        movedCurrent.push(entry);
      }
      const staged = path.join(applyStage, entry);
      if (fs.existsSync(staged)) {
        safeRename(staged, current);
        installedNew.push(entry);
      }
    }
    fs.writeFileSync(
      path.join(maintenance, "last-restore.json"),
      JSON.stringify({ ok: true, completedAt: new Date().toISOString(), sourceVersion: pending.sourceVersion, safetyBackup: pending.safetyBackup }, null, 2),
      "utf-8",
    );
    fs.rmSync(pendingFile, { force: true });
    fs.rmSync(path.dirname(path.dirname(payload)), { recursive: true, force: true });
    fs.rmSync(applyStage, { recursive: true, force: true });
    try { fs.rmSync(rollback, { recursive: true, force: true }); } catch { /* cleanup is non-fatal */ }
  } catch (error: any) {
    for (const entry of installedNew.reverse()) fs.rmSync(path.join(dataDir, entry), { recursive: true, force: true });
    for (const entry of movedCurrent.reverse()) {
      const source = path.join(rollback, entry);
      if (fs.existsSync(source)) safeRename(source, path.join(dataDir, entry));
    }
    fs.writeFileSync(
      path.join(maintenance, "last-restore.json"),
      JSON.stringify({ ok: false, completedAt: new Date().toISOString(), error: error?.message || String(error) }, null, 2),
      "utf-8",
    );
    throw error;
  }
}
