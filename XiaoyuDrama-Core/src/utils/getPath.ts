import fs from "node:fs";
import path from "node:path";
import isPathInside from "is-path-inside";

const SEEDED_MUTABLE_DIRS = new Set(["vendor", "skills", "modelPrompt"]);
const BUNDLED_ONLY_DIRS = new Set(["models", "assets", "web", "bin"]);
const seeded = new Set<string>();

function bundledDataRoot(): string {
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "data");
  }
  return path.join(process.cwd(), "data");
}

function persistentDataRoot(): string | null {
  const configured = String(process.env.XIAOYU_DATA_DIR || "").trim();
  if (!configured) return null;
  return path.resolve(configured);
}

function firstSegment(fileName: string[] | string): string {
  const first = Array.isArray(fileName) ? String(fileName[0] || "") : String(fileName || "");
  return first.replace(/^[\\/]+/, "").split(/[\\/]/, 1)[0] || "";
}

function copyMissing(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyMissing(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function ensureSeededDirectory(name: string, persistentRoot: string): void {
  if (seeded.has(name)) return;
  const source = path.join(bundledDataRoot(), name);
  const target = path.join(persistentRoot, name);
  copyMissing(source, target);
  seeded.add(name);
}

export default (fileName?: string[] | string) => {
  const bundledRoot = path.resolve(bundledDataRoot());
  const persistentRoot = persistentDataRoot();

  if (!persistentRoot) {
    if (!fileName) return bundledRoot;
    const result = Array.isArray(fileName)
      ? path.resolve(bundledRoot, ...fileName)
      : path.resolve(bundledRoot, fileName);
    if (!isPathInside(result, bundledRoot) && result !== bundledRoot) {
      throw new Error("路径逃逸错误，路径必须在数据目录内");
    }
    return result;
  }

  fs.mkdirSync(persistentRoot, { recursive: true });
  if (!fileName) return persistentRoot;

  const segment = firstSegment(fileName);
  let root = persistentRoot;
  if (BUNDLED_ONLY_DIRS.has(segment)) {
    root = bundledRoot;
  } else if (SEEDED_MUTABLE_DIRS.has(segment)) {
    ensureSeededDirectory(segment, persistentRoot);
  }

  const result = Array.isArray(fileName)
    ? path.resolve(root, ...fileName)
    : path.resolve(root, fileName);
  if (!isPathInside(result, root) && result !== root) {
    throw new Error("路径逃逸错误，路径必须在数据目录内");
  }
  return result;
};

export function isEletron() {
  return typeof process.versions?.electron !== "undefined";
}
