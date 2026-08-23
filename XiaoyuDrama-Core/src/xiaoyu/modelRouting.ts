import db from "@/utils/db";

export const XIAOYU_MODEL_PREFIX = "xiaoyu_compute_center:";
export const CUSTOM_POLICY_VERSION = "custom-provider-v1";
export type ProjectProviderMode = "xiaoyu" | "custom" | "mixed" | "unconfigured";

const AGENT_LABELS: Record<string, string> = { scriptAgent: "编剧 Agent", productionAgent: "生产 Agent", universalAi: "通用 Agent" };

export function isXiaoyuModel(modelName: unknown): boolean {
  return String(modelName || "").startsWith(XIAOYU_MODEL_PREFIX);
}

export function getProjectProviderMode(project: any): ProjectProviderMode {
  const imageModel = String(project?.imageModel || "").trim();
  const videoModel = String(project?.videoModel || "").trim();
  const selected = [imageModel, videoModel].filter(Boolean);
  if (!selected.length) return "unconfigured";
  const xiaoyuCount = selected.filter(isXiaoyuModel).length;
  if (xiaoyuCount === selected.length && selected.length === 2) return "xiaoyu";
  if (xiaoyuCount > 0) return "mixed";
  return "custom";
}

export interface ModelRouteAvailability {
  ok: boolean;
  modelName: string;
  vendorId: string;
  modelId: string;
  reason?: string;
}

export async function getModelRouteAvailability(modelName: unknown): Promise<ModelRouteAvailability> {
  const value = String(modelName || "").trim();
  const match = value.match(/^([^:]+):(.+)$/);
  if (!match) return { ok: false, modelName: value, vendorId: "", modelId: "", reason: "模型路由格式无效，应为 provider:model" };
  const [, vendorId, modelId] = match;
  const vendor = await db("o_vendorConfig").where({ id: vendorId }).first("id", "enable");
  if (!vendor) return { ok: false, modelName: value, vendorId, modelId, reason: `AI Provider ${vendorId} 已不存在` };
  if (Number(vendor.enable || 0) !== 1) return { ok: false, modelName: value, vendorId, modelId, reason: `AI Provider ${vendorId} 未启用` };
  return { ok: true, modelName: value, vendorId, modelId };
}

export async function getCustomAgentConfigurationState(): Promise<{ missing: string[]; invalid: string[]; xiaoyuBound: string[] }> {
  const required = ["scriptAgent", "productionAgent", "universalAi"];
  const rows = await db("o_agentDeploy").whereIn("key", required).select("key", "modelName", "vendorId");
  const byKey = new Map(rows.map((row: any) => [String(row.key), row]));
  const missing: string[] = [];
  const invalid: string[] = [];
  const xiaoyuBound: string[] = [];
  for (const key of required) {
    const label = AGENT_LABELS[key] || key;
    const row: any = byKey.get(key);
    const modelName = String(row?.modelName || "").trim();
    if (!modelName) { missing.push(label); continue; }
    if (isXiaoyuModel(modelName)) xiaoyuBound.push(label);
    const route = await getModelRouteAvailability(modelName);
    if (!route.ok) { invalid.push(`${label}：${route.reason}`); continue; }
    const storedVendorId = String(row?.vendorId || "").trim();
    if (storedVendorId && storedVendorId !== route.vendorId) invalid.push(`${label}：保存的 Provider(${storedVendorId}) 与模型路由(${route.vendorId})不一致`);
  }
  return { missing, invalid, xiaoyuBound };
}
