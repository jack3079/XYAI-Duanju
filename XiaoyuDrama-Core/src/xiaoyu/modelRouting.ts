import db from "@/utils/db";
import * as vendorRegistry from "@/utils/vendor";

export const XIAOYU_MODEL_PREFIX = "xiaoyu_compute_center:";
export const CUSTOM_POLICY_VERSION = "custom-provider-v1";
export type ProjectProviderMode = "xiaoyu" | "custom" | "mixed" | "unconfigured";
export type ModelCapabilityType = "text" | "image" | "video";

const AGENT_LABELS: Record<string, string> = {
  scriptAgent: "编剧 Agent",
  productionAgent: "生产 Agent",
  universalAi: "通用 Agent",
};

export function isXiaoyuModel(modelName: unknown): boolean {
  return String(modelName || "").startsWith(XIAOYU_MODEL_PREFIX);
}

export function getProjectProviderMode(project: any): ProjectProviderMode {
  const imageModel = String(project?.imageModel || "").trim();
  const videoModel = String(project?.videoModel || "").trim();
  // 项目图片/视频模型缺任意一项都属于“尚未配置完整”。
  if (!imageModel || !videoModel) return "unconfigured";
  const selected = [imageModel, videoModel];
  const xiaoyuCount = selected.filter(isXiaoyuModel).length;
  if (xiaoyuCount === 2) return "xiaoyu";
  if (xiaoyuCount === 1) return "mixed";
  return "custom";
}

export interface ModelRouteAvailability {
  ok: boolean;
  modelName: string;
  vendorId: string;
  modelId: string;
  modelType?: string;
  reason?: string;
}

export async function getModelRouteAvailability(
  modelName: unknown,
  expectedType?: ModelCapabilityType,
): Promise<ModelRouteAvailability> {
  const value = String(modelName || "").trim();
  const match = value.match(/^([^:]+):(.+)$/);
  if (!match) {
    return {
      ok: false,
      modelName: value,
      vendorId: "",
      modelId: "",
      reason: "模型路由格式无效，应为 provider:model",
    };
  }

  const [, vendorId, modelId] = match;
  const provider = await db("o_vendorConfig").where({ id: vendorId }).first("id", "enable");
  if (!provider) return { ok: false, modelName: value, vendorId, modelId, reason: `AI Provider ${vendorId} 已不存在` };
  if (Number(provider.enable || 0) !== 1) {
    return { ok: false, modelName: value, vendorId, modelId, reason: `AI Provider ${vendorId} 未启用` };
  }

  try {
    const models = await vendorRegistry.getModelList(vendorId);
    const selected = models.find((item: any) => String(item?.modelName || "") === modelId);
    if (!selected) {
      return { ok: false, modelName: value, vendorId, modelId, reason: `AI Provider ${vendorId} 中已不存在模型 ${modelId}` };
    }
    const modelType = String(selected?.type || "");
    if (expectedType && modelType !== expectedType) {
      return {
        ok: false,
        modelName: value,
        vendorId,
        modelId,
        modelType,
        reason: `模型 ${modelId} 类型为 ${modelType || "未知"}，当前需要 ${expectedType} 模型`,
      };
    }
    return { ok: true, modelName: value, vendorId, modelId, modelType };
  } catch (exception) {
    return {
      ok: false,
      modelName: value,
      vendorId,
      modelId,
      reason: `AI Provider ${vendorId} 模型配置读取失败：${exception instanceof Error ? exception.message : String(exception)}`,
    };
  }
}

export async function getCustomAgentConfigurationState(): Promise<{
  missing: string[];
  invalid: string[];
  xiaoyuBound: string[];
}> {
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
    if (!modelName) {
      missing.push(label);
      continue;
    }
    if (isXiaoyuModel(modelName)) xiaoyuBound.push(label);
    const route = await getModelRouteAvailability(modelName, "text");
    if (!route.ok) {
      invalid.push(`${label}：${route.reason}`);
      continue;
    }
    const storedVendorId = String(row?.vendorId || "").trim();
    if (storedVendorId && storedVendorId !== route.vendorId) {
      invalid.push(`${label}：保存的 Provider(${storedVendorId}) 与模型路由(${route.vendorId})不一致`);
    }
  }
  return { missing, invalid, xiaoyuBound };
}
