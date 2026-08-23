import db from "@/utils/db";
import * as vendor from "@/utils/vendor";

export interface NormalizedAgentModelSelection {
  vendorId: string | null;
  model: string;
  modelName: string;
}

export async function normalizeAgentModelSelection(
  vendorId: unknown,
  model: unknown,
  modelName: unknown,
): Promise<NormalizedAgentModelSelection> {
  const providerId = String(vendorId ?? "").trim();
  const rawModel = String(model ?? "").trim();
  const composite = String(modelName ?? "").trim();

  if (!providerId) {
    if (rawModel || composite) throw new Error("未选择 AI 供应商时不能保存模型；请重新选择模型或清空该 Agent 配置");
    return { vendorId: null, model: "", modelName: "" };
  }
  if (!rawModel) throw new Error(`供应商 ${providerId} 缺少模型标识`);

  const expected = `${providerId}:${rawModel}`;
  if (composite && composite !== expected) {
    throw new Error(`模型配置不一致：期望 ${expected}，收到 ${composite}`);
  }

  const provider = await db("o_vendorConfig").where("id", providerId).first("id", "enable");
  if (!provider) throw new Error(`AI 供应商不存在：${providerId}`);
  if (Number(provider.enable || 0) !== 1) throw new Error(`AI 供应商未启用：${providerId}`);

  const models = await vendor.getModelList(providerId);
  const selected = models.find((item: any) => String(item?.modelName || "") === rawModel);
  if (!selected) throw new Error(`供应商 ${providerId} 中不存在模型：${rawModel}`);
  if (String(selected.type || "") !== "text") {
    throw new Error(`Agent 只能配置文本模型：${expected} 当前类型为 ${selected.type || "未知"}`);
  }

  return { vendorId: providerId, model: rawModel, modelName: expected };
}
