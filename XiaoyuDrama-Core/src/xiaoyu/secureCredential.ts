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

function legacyMachineFingerprint(): string {
  let username = "unknown";
  try { username = os.userInfo().username || username; } catch { /* ignore */ }
  return [os.hostname(), username, os.platform(), os.arch()].join("|");
}

function primaryCredentialContext(): string {
  const explicit = String(process.env.XIAOYU_CREDENTIAL_CONTEXT || "").trim();
  if (explicit) return `xiaoyu-context:${explicit}`;
  if (String(process.env.XIAOYU_DATA_DIR || "").trim()) return "xiaoyu-context:docker-v1";
  return legacyMachineFingerprint();
}

function decodeInstallationSecret(filename: string): Buffer | null {
  try {
    const text = fs.readFileSync(filename, "utf-8").trim();
    if (!text) return null;
    const decoded = Buffer.from(text, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function archiveCorruptSecret(filename: string): void {
  if (!fs.existsSync(filename)) return;
  const archived = `${filename}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    fs.renameSync(filename, archived);
    console.warn(`[xiaoyu] 凭据密钥损坏，已隔离旧文件：${path.basename(archived)}`);
  } catch {
    try { fs.rmSync(filename, { force: true }); } catch { /* create below will surface the real error */ }
  }
}

function createInstallationSecret(filename: string): Buffer {
  const secret = crypto.randomBytes(32);
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, secret.toString("base64"), { encoding: "utf-8", mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temporary, filename);
  } catch (exception: any) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* ignore */ }
    const existing = decodeInstallationSecret(filename);
    if (existing) return existing;
    throw exception;
  }
  try { fs.chmodSync(filename, 0o600); } catch { /* Windows uses ACL */ }
  return secret;
}

function loadOrCreateInstallationSecret(): Buffer {
  const filename = credentialKeyFile();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (fs.existsSync(filename)) {
    const existing = decodeInstallationSecret(filename);
    if (existing) return existing;
    archiveCorruptSecret(filename);
  }
  return createInstallationSecret(filename);
}

function deriveKey(fingerprint: string): Buffer {
  return crypto.scryptSync(fingerprint, loadOrCreateInstallationSecret(), 32, {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function decryptWithFingerprint(stored: string, fingerprint: string): string {
  const [prefix, version, ivText, tagText, encryptedText] = stored.split(":");
  if (`${prefix}:${version}` !== FORMAT_PREFIX || !ivText || !tagText || !encryptedText) {
    throw new Error("小鱼本机登录凭据格式无效，请重新配置小鱼智算中心 API Token");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(fingerprint), Buffer.from(ivText, "base64url"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf-8");
}

function decryptCredential(stored: string): { token: string; usedLegacyContext: boolean } {
  const primary = primaryCredentialContext();
  const legacy = legacyMachineFingerprint();
  const candidates = [...new Set([primary, legacy])];
  let lastError: unknown;
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      return { token: decryptWithFingerprint(stored, candidates[index]), usedLegacyContext: index > 0 };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("小鱼本机登录凭据无法解密，请重新配置小鱼智算中心 API Token");
}

export function encryptXiaoyuCredential(token: string): string {
  const value = token.trim().replace(/^Bearer\s+/i, "");
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(primaryCredentialContext()), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  return [FORMAT_PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptXiaoyuCredential(value: string): string {
  const stored = String(value || "").trim();
  if (!stored) return "";
  try {
    return decryptCredential(stored).token;
  } catch {
    throw new Error("小鱼本机登录凭据无法解密，请重新配置小鱼智算中心 API Token");
  }
}

export function migrateXiaoyuCredential(inputValues: Record<string, unknown>): { credential: string; migrated: boolean } {
  const credential = String(inputValues.credential || "").trim();
  if (credential) {
    const result = decryptCredential(credential);
    if (result.usedLegacyContext) return { credential: encryptXiaoyuCredential(result.token), migrated: true };
    return { credential, migrated: Boolean(inputValues.apiKey) };
  }
  const legacy = String(inputValues.apiKey || "").trim();
  return { credential: legacy ? encryptXiaoyuCredential(legacy) : "", migrated: Boolean(legacy) };
}
