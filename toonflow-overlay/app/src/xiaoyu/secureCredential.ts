import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import getPath from "@/utils/getPath";

const FORMAT_PREFIX = "xycred:v1";
const AAD = Buffer.from("xiaoyu-compute-center|xiaoyu-drama|credential-v1", "utf-8");

function credentialKeyFile(): string {
  return getPath("xiaoyu-credential.key");
}

function machineFingerprint(): string {
  let username = "unknown";
  try {
    username = os.userInfo().username || username;
  } catch {
    // 某些受限 Windows 账户无法读取 userInfo，继续使用其余机器属性。
  }
  return [os.hostname(), username, os.platform(), os.arch()].join("|");
}

function loadOrCreateInstallationSecret(): Buffer {
  const filename = credentialKeyFile();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (fs.existsSync(filename)) {
    const encoded = fs.readFileSync(filename, "utf-8").trim();
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== 32) throw new Error("小鱼本机凭据密钥损坏，请重新登录小鱼智算中心");
    return decoded;
  }

  const secret = crypto.randomBytes(32);
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, secret.toString("base64"), { encoding: "utf-8", mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temporary, filename);
  } catch (exception: any) {
    // 多进程同时首次启动时，只允许一个进程落盘，其他进程读取最终文件。
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // 忽略临时文件清理失败，后续安装诊断会报告残留文件。
    }
    if (!fs.existsSync(filename)) throw exception;
  }
  try {
    fs.chmodSync(filename, 0o600);
  } catch {
    // Windows ACL 不采用 POSIX mode；文件仍位于当前用户的应用数据目录。
  }
  return fs.existsSync(filename) ? Buffer.from(fs.readFileSync(filename, "utf-8").trim(), "base64") : secret;
}

function deriveKey(): Buffer {
  const installationSecret = loadOrCreateInstallationSecret();
  return crypto.scryptSync(machineFingerprint(), installationSecret, 32, {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

export function encryptXiaoyuCredential(token: string): string {
  const value = token.trim().replace(/^Bearer\s+/i, "");
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptXiaoyuCredential(value: string): string {
  const stored = String(value || "").trim();
  if (!stored) return "";
  const [prefix, version, ivText, tagText, encryptedText] = stored.split(":");
  if (`${prefix}:${version}` !== FORMAT_PREFIX || !ivText || !tagText || !encryptedText) {
    throw new Error("小鱼本机登录凭据格式无效，请重新登录小鱼智算中心");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivText, "base64url"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf-8");
  } catch {
    throw new Error("小鱼本机登录凭据无法解密，请重新登录小鱼智算中心");
  }
}

export function migrateXiaoyuCredential(inputValues: Record<string, unknown>): {
  credential: string;
  migrated: boolean;
} {
  const credential = String(inputValues.credential || "").trim();
  if (credential) {
    // 读取一次以尽早发现被复制到其他电脑或遭到篡改的凭据。
    decryptXiaoyuCredential(credential);
    return { credential, migrated: Boolean(inputValues.apiKey) };
  }
  const legacy = String(inputValues.apiKey || "").trim();
  return { credential: legacy ? encryptXiaoyuCredential(legacy) : "", migrated: Boolean(legacy) };
}
