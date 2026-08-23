import { transform } from "sucrase";
import fs from "node:fs";
import path from "node:path";
import u from "@/utils";

const VENDOR_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function validateVendorId(id: string | number): string {
  const value = String(id || "").trim();
  if (!VENDOR_ID_PATTERN.test(value)) {
    throw new Error("供应商 id 只能包含英文、数字、点、下划线和短横线");
  }
  return value;
}

function safeVendorPath(id: string | number): string {
  const idStr = validateVendorId(id);
  const rootDir = path.resolve(u.getPath("vendor"));
  const targetFile = path.resolve(rootDir, `${idStr}.ts`);
  if (path.dirname(targetFile) !== rootDir) throw new Error(`供应商路径非法：${idStr}`);
  return targetFile;
}

export function writeCode(id: string | number, tsCode: string) {
  if (typeof tsCode !== "string" || tsCode.trim().length === 0) {
    throw new Error("供应商脚本不能为空");
  }
  const targetFile = safeVendorPath(id);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const temporary = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, tsCode, "utf-8");
  try {
    fs.renameSync(temporary, targetFile);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

export function deleteCode(id: string | number): void {
  const targetFile = safeVendorPath(id);
  fs.rmSync(targetFile, { force: true });
}

export function getCode(id: string): string {
  const targetFile = safeVendorPath(id);
  if (!fs.existsSync(targetFile)) return "";
  return fs.readFileSync(targetFile, "utf-8");
}

function evaluateVendor(id: string): any {
  const code = getCode(id);
  if (!code.trim()) throw new Error(`供应商脚本不存在：${id}`);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  if (!vendorData || !vendorData.vendor) throw new Error(`供应商脚本未导出 vendor：${id}`);
  return vendorData;
}

export async function getModelList(id: string): Promise<Array<any>> {
  validateVendorId(id);
  const config = await u.db("o_vendorConfig").where("id", id).select("models").first();
  const vendorData = evaluateVendor(id);
  const builtInModels = Array.isArray(vendorData.vendor.models) ? vendorData.vendor.models : [];
  let customModels: any[] = [];
  try {
    const parsed = JSON.parse(String(config?.models || "[]"));
    if (Array.isArray(parsed)) customModels = parsed;
  } catch {
    console.warn(`[vendor] models JSON 损坏，已忽略自定义模型：${id}`);
  }
  const combined = [...JSON.parse(JSON.stringify(builtInModels)), ...JSON.parse(JSON.stringify(customModels))];
  const map = new Map<string, any>();
  for (const model of combined) {
    const modelName = String(model?.modelName || "").trim();
    if (!modelName) continue;
    map.set(modelName, model);
  }
  return [...map.values()];
}

export function getVendor(id: string) {
  validateVendorId(id);
  return evaluateVendor(id).vendor;
}
