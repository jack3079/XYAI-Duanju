import fs from "fs";
import path from "path";
import isPathInside from "is-path-inside";

function firstSegment(fileName?: string[] | string): string {
  if (!fileName) return "";
  if (Array.isArray(fileName)) return String(fileName[0] || "");
  return String(fileName).replace(/\\/g, "/").split("/")[0] || "";
}

function seedBundledDirectory(runtimeRoot: string, name: string): void {
  const target = path.join(runtimeRoot, name);
  if (fs.existsSync(target)) return;
  const bundled = path.join(process.cwd(), "data", name);
  if (!fs.existsSync(bundled)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(bundled, target, { recursive: true });
}

export default (fileName?: string[] | string) => {
  let basePath: string;
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    const userDataDir: string = app.getPath("userData");
    basePath = path.join(userDataDir, "data");
  } else {
    const configuredDataDir = String(process.env.XIAOYU_DATA_DIR || "").trim();
    const runtimeRoot = configuredDataDir ? path.resolve(configuredDataDir) : "";
    const segment = firstSegment(fileName);
    if (runtimeRoot && segment === "skills") seedBundledDirectory(runtimeRoot, "skills");
    const bundledOnly = segment === "web" || segment === "assets";
    basePath = runtimeRoot && !bundledOnly ? runtimeRoot : path.join(process.cwd(), "data");
  }
  if (fileName) {
    const resolved = Array.isArray(fileName) ? path.resolve(basePath, ...fileName) : path.resolve(basePath, fileName);
    if (!isPathInside(resolved, basePath) && resolved !== basePath) throw new Error("路径逃逸错误，路径必须在数据目录内");
    return resolved;
  }
  return basePath;
};
export function isEletron() { return typeof process.versions?.electron !== "undefined"; }
