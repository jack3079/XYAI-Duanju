import isPathInside from "is-path-inside";
import getPath, { isEletron } from "@/utils/getPath";
import fs from "node:fs/promises";
import path from "node:path";

function normalizeUserPath(userPath: string): string {
  const trimmedPath = userPath.replace(/^[/\\]+/, "");
  return trimmedPath.split("/").join(path.sep);
}

function resolveSafeLocalPath(userPath: string, rootDir: string): string {
  const safePath = normalizeUserPath(userPath);
  const absPath = path.join(rootDir, safePath);
  if (!isPathInside(absPath, rootDir)) throw new Error(`${userPath} 不在 OSS 根目录内`);
  return absPath;
}

class OSS {
  private rootDir: string;
  private initPromise: Promise<void>;

  constructor() {
    this.rootDir = getPath("oss");
    this.initPromise = fs.mkdir(this.rootDir, { recursive: true }).then(() => {});
  }

  private async ensureInit() {
    await this.initPromise;
  }

  async getFileUrl(userRelPath: string, prefix?: string): Promise<string> {
    if (!prefix) prefix = "oss";
    await this.ensureInit();
    const safePath = normalizeUserPath(userRelPath);
    let url = `/${prefix}/`;
    const externalBase = String(process.env.ossURL || process.env.XIAOYU_PUBLIC_BACKEND_URL || "").trim().replace(/\/+$/, "");
    if (externalBase) url = `${externalBase}/${prefix}/`;
    if (isEletron()) url = `http://localhost:${process.env.PORT}/${prefix}/`;
    return `${url}${safePath.split(path.sep).join("/")}`;
  }

  async getFile(userRelPath: string): Promise<Buffer> {
    await this.ensureInit();
    return fs.readFile(resolveSafeLocalPath(userRelPath, this.rootDir));
  }

  async getImageBase64(userRelPath: string): Promise<string> {
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) throw new Error(`${userRelPath} 不是文件`);
    const ext = path.extname(userRelPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
      ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".tiff": "image/tiff", ".tif": "image/tiff",
      ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
      ".flac": "audio/flac", ".ogg": "audio/ogg", ".webm": "video/webm",
    };
    const mimeType = mimeTypes[ext];
    if (!mimeType) throw new Error(`不支持的图片格式: ${ext}。支持的格式: ${Object.keys(mimeTypes).join(", ")}`);
    const data = await fs.readFile(absPath);
    return `data:${mimeType};base64,${data.toString("base64")}`;
  }

  async deleteFile(userRelPath: string): Promise<void> {
    await this.ensureInit();
    await fs.unlink(resolveSafeLocalPath(userRelPath, this.rootDir));
  }

  async deleteDirectory(userRelPath: string): Promise<void> {
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    const stat = await fs.stat(absPath);
    if (!stat.isDirectory()) throw new Error(`${userRelPath} 不是文件夹`);
    await fs.rm(absPath, { recursive: true, force: true });
  }

  async writeFile(userRelPath: string, data: Buffer | string): Promise<void> {
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const buffer = typeof data === "string" ? Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64") : data;
    await fs.writeFile(absPath, buffer);
  }

  async fileExists(userRelPath: string): Promise<boolean> {
    await this.ensureInit();
    try {
      const stat = await fs.stat(resolveSafeLocalPath(userRelPath, this.rootDir));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async getSmallImageUrl(userRelPath: string): Promise<string> {
    return (await this.getFileUrl(userRelPath)) + "?size=20";
  }
}

export default new OSS();
