import { VM } from "vm2";
import sharp from "sharp";
import axios from "axios";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createZhipu } from "zhipu-ai-provider";
import { createQwen } from "qwen-ai-provider-v5";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createMinimax } from "vercel-minimax-ai-provider";
import FormData from "form-data";
import jsonwebtoken from "jsonwebtoken";
import u from "@/utils";
import crypto from "node:crypto";
import { recordXiaoyuRemoteJobEvent } from "@/xiaoyu/remoteJobEvents";

function boundedEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function providerVmTimeoutMs(): number {
  return boundedEnvNumber("XIAOYU_VENDOR_VM_TIMEOUT_MS", 3000, 100, 30000);
}

function providerDownloadTimeoutMs(): number {
  return boundedEnvNumber("XIAOYU_PROVIDER_DOWNLOAD_TIMEOUT_MS", 120000, 5000, 600000);
}

function providerDownloadMaxBytes(): number {
  return boundedEnvNumber("XIAOYU_PROVIDER_DOWNLOAD_MAX_BYTES", 256 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024);
}

export default function runCode(code: string, vendor?: Record<string, any>) {
  if (typeof code !== "string" || !code.trim()) throw new Error("Provider 脚本为空");
  code = code.replace(/export\s*\{\s*\};?/g, "");

  const exports = {};
  const sandbox: Record<string, any> = {
    createOpenAI,
    createDeepSeek,
    createZhipu,
    createQwen,
    createAnthropic,
    createOpenAICompatible,
    createXai,
    createMinimax,
    createGoogleGenerativeAI,
    zipImage,
    zipImageResolution,
    urlToBase64,
    mergeImages,
    pollTask,
    fetch,
    exports,
    axios,
    FormData,
    Buffer,
    logger,
    jsonwebtoken,
    crypto,
    xiaoyuJobEvent: recordXiaoyuRemoteJobEvent,
  };
  if (vendor !== undefined) sandbox.vendor = vendor;

  const vm = new VM({
    // 只限制 Provider 顶层脚本初始化。异步模型请求由各网络 helper 自己负责超时。
    // timeout=0 会让一个错误的 while(true) 永久冻结整个后端进程。
    timeout: providerVmTimeoutMs(),
    sandbox,
    compiler: "javascript",
    eval: false,
    wasm: false,
  });

  try {
    vm.run(code);
  } catch (error) {
    throw new Error(`Provider 脚本初始化失败：${u.error(error).message}`);
  }
  return exports as Record<string, any>;
}

export function logger(logValue: any) {
  try {
    console.log("【VM】" + JSON.stringify(logValue));
  } catch {
    console.log("【VM】[无法序列化的日志对象]");
  }
}

function base64Payload(value: string): Buffer {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Base64 图片数据为空");
  const payload = raw.replace(/^data:[^;]+;base64,/i, "");
  if (!payload) throw new Error("Base64 图片数据为空");
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length) throw new Error("Base64 图片数据无效");
  return buffer;
}

/** 压缩图片，目标字节数不高于 size。 */
export async function zipImage(completeBase64: string, size: number): Promise<string> {
  if (!Number.isFinite(size) || size <= 0) throw new Error("图片目标大小必须大于 0");
  let quality = 80;
  const buffer = base64Payload(completeBase64);
  let output = await sharp(buffer).jpeg({ quality }).toBuffer();
  while (output.length > size && quality > 10) {
    quality -= 10;
    output = await sharp(buffer).jpeg({ quality }).toBuffer();
  }
  return "data:image/jpeg;base64," + output.toString("base64");
}

export async function zipImageResolution(completeBase64: string, width: number, height: number): Promise<string> {
  const safeWidth = Math.trunc(Number(width));
  const safeHeight = Math.trunc(Number(height));
  if (safeWidth < 1 || safeHeight < 1 || safeWidth > 16384 || safeHeight > 16384) {
    throw new Error(`图片尺寸无效：${width}x${height}`);
  }
  const buffer = base64Payload(completeBase64);
  const out = await sharp(buffer).resize(safeWidth, safeHeight).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/** Provider 脚本使用的 URL -> Base64 helper。 */
export async function urlToBase64(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    throw new Error(`无效媒体 URL：${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`不支持的媒体 URL 协议：${parsed.protocol}`);

  const maxBytes = providerDownloadMaxBytes();
  const response = await axios.get(parsed.toString(), {
    responseType: "arraybuffer",
    timeout: providerDownloadTimeoutMs(),
    maxRedirects: 5,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const data = Buffer.from(response.data);
  if (!data.length) throw new Error("媒体 URL 返回空文件");
  if (data.length > maxBytes) throw new Error(`媒体文件超过安全限制 ${maxBytes} bytes`);
  const mime = String(response.headers["content-type"] || "application/octet-stream").split(";", 1)[0];
  return `data:${mime};base64,${data.toString("base64")}`;
}

export async function pollTask(
  fn: () => Promise<{ completed: boolean; data?: string; error?: string }>,
  interval = 3000,
  timeout = 3000000,
): Promise<{ completed: boolean; data?: string; error?: string }> {
  const safeInterval = Math.min(Math.max(Math.trunc(Number(interval) || 3000), 500), 60000);
  const safeTimeout = Math.min(Math.max(Math.trunc(Number(timeout) || 3000000), 1000), 2 * 60 * 60 * 1000);
  const start = Date.now();
  let consecutiveErrors = 0;
  let lastError = "";

  while (Date.now() - start < safeTimeout) {
    try {
      const result = await fn();
      consecutiveErrors = 0;
      if (result.completed) return result;
      if (result?.error) return result;
    } catch (error) {
      consecutiveErrors += 1;
      lastError = u.error(error).message || "poll error";
      // 网络偶发抖动不应立即判定长任务失败，但连续失败需要及时返回。
      if (consecutiveErrors >= 3) return { completed: false, error: lastError };
    }
    await new Promise((resolve) => setTimeout(resolve, safeInterval));
  }
  return { completed: false, error: lastError ? `timeout；最后错误：${lastError}` : "timeout" };
}

/** 将多张图片横向拼接，并控制输出大小。 */
export async function mergeImages(imageBase64List: string[], maxSize = "10mb"): Promise<string> {
  if (!Array.isArray(imageBase64List) || imageBase64List.length === 0) throw new Error("图片列表不能为空");
  if (imageBase64List.length > 32) throw new Error("单次最多允许拼接 32 张图片");

  const maxBytes = parseSize(maxSize);
  const imageBuffers = imageBase64List.map(base64Payload);
  const imageMetadatas = await Promise.all(imageBuffers.map((buffer) => sharp(buffer).metadata()));
  const maxHeight = Math.max(...imageMetadatas.map((metadata) => Number(metadata.height || 0)));
  if (!Number.isFinite(maxHeight) || maxHeight < 1) throw new Error("无法读取图片尺寸");

  const imageWidths = imageMetadatas.map((metadata) => {
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (width < 1 || height < 1) throw new Error("图片尺寸无效");
    return Math.max(1, Math.round(maxHeight * (width / height)));
  });
  const totalWidth = imageWidths.reduce((sum, width) => sum + width, 0);
  if (totalWidth > 65535 || maxHeight > 65535) throw new Error("拼接后的图片尺寸过大");

  const resizedImages = await Promise.all(
    imageBuffers.map((buffer, index) => sharp(buffer).resize(imageWidths[index], maxHeight, { fit: "cover" }).toBuffer()),
  );

  let currentX = 0;
  const compositeInputs = resizedImages.map((buffer, index) => {
    const input = { input: buffer, left: currentX, top: 0 };
    currentX += imageWidths[index];
    return input;
  });

  const mergedBuffer = await sharp({
    create: {
      width: totalWidth,
      height: maxHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(compositeInputs)
    .jpeg({ quality: 90 })
    .toBuffer();

  const resultBuffer = await compressToSize(mergedBuffer, maxBytes, totalWidth, maxHeight);
  return resultBuffer.toString("base64");
}

function parseSize(size: string): number {
  const match = String(size || "").toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)?$/);
  if (!match) throw new Error(`无效的大小格式: ${size}`);
  const value = parseFloat(match[1]);
  const unit = match[2] || "b";
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  const result = Math.floor(value * multipliers[unit]);
  if (!Number.isFinite(result) || result < 1024 || result > 1024 * 1024 * 1024) {
    throw new Error(`图片目标大小超出允许范围：${size}`);
  }
  return result;
}

async function compressToSize(imageBuffer: Buffer, maxBytes: number, originalWidth: number, originalHeight: number): Promise<Buffer> {
  let quality = 90;
  let scale = 1;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targetWidth = Math.max(1, Math.round(originalWidth * scale));
    const targetHeight = Math.max(1, Math.round(originalHeight * scale));
    const resultBuffer = await sharp(imageBuffer)
      .resize(targetWidth, targetHeight, { fit: "fill" })
      .jpeg({ quality })
      .toBuffer();

    if (resultBuffer.length <= maxBytes) return resultBuffer;
    if (quality > 10) quality -= 10;
    else {
      quality = 90;
      scale *= 0.8;
      if (targetWidth === 1 && targetHeight === 1) break;
    }
  }
  throw new Error(`无法将图片压缩到 ${maxBytes} bytes 以内`);
}
