import u from "@/utils";

const MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

export interface PreparedAudioFile {
  path: string;
  bytes: number;
  mime: string;
}

export function normalizeStoredAssetPath(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw || /^https?:\/\//i.test(raw) && !/\/oss\//i.test(raw)) return "";
  return String(u.replaceUrl(raw) || "").replace(/^\/+/, "");
}

export async function writeAudioDataUrl(projectId: number, value: unknown): Promise<PreparedAudioFile> {
  const dataUrl = String(value || "").trim();
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("音频文件格式无效，请重新选择音频文件");

  const mime = match[1].toLowerCase();
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error(`不支持的音频格式：${mime}`);

  const compact = match[2].replace(/\s+/g, "");
  if (!compact || compact.length % 4 === 1) throw new Error("音频 Base64 数据无效");
  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length) throw new Error("音频文件为空");
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error("单个音频文件不能超过 100MB");

  const savePath = `${projectId}/assets/audio/${u.uuid()}.${ext}`;
  await u.oss.writeFile(savePath, buffer);
  return { path: savePath, bytes: buffer.length, mime };
}

export async function deleteLocalAssetFiles(paths: Iterable<string>): Promise<number> {
  let warnings = 0;
  for (const value of new Set([...paths].map((item) => normalizeStoredAssetPath(item)).filter(Boolean))) {
    try {
      await u.oss.deleteFile(value);
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        warnings += 1;
        console.warn(`[assets] 文件清理失败：${value}`, error);
      }
    }
  }
  return warnings;
}
