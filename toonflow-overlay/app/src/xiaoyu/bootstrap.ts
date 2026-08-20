import crypto from "node:crypto";
import os from "node:os";
import u from "@/utils";
import { XIAOYU_BRAND } from "./brand";
import { migrateXiaoyuCredential } from "./secureCredential";

const modelByAgentKey: Record<string, { alias: string; name: string }> = {
  scriptAgent: { alias: "xy-script-creative", name: "小鱼自动编剧" },
  productionAgent: { alias: "xy-director", name: "小鱼自动导演" },
  universalAi: { alias: "xy-general", name: "小鱼通用处理" },
  ttsDubbing: { alias: "xy-tts-auto", name: "小鱼自动配音" },
  "scriptAgent:decisionAgent": { alias: "xy-script-creative", name: "小鱼编剧决策" },
  "scriptAgent:supervisionAgent": { alias: "xy-script-review", name: "小鱼剧本复审" },
  "scriptAgent:storySkeletonAgent": { alias: "xy-script-creative", name: "小鱼故事骨架" },
  "scriptAgent:adaptationStrategyAgent": { alias: "xy-script-creative", name: "小鱼改编策略" },
  "scriptAgent:scriptAgent": { alias: "xy-script-creative", name: "小鱼剧本生成" },
  "productionAgent:decisionAgent": { alias: "xy-director", name: "小鱼生产决策" },
  "productionAgent:supervisionAgent": { alias: "xy-script-review", name: "小鱼生产复审" },
  "productionAgent:deriveAssetsAgent": { alias: "xy-general", name: "小鱼资产提取" },
  "productionAgent:generateAssetsAgent": { alias: "xy-general", name: "小鱼资产生成" },
  "productionAgent:directorPlanAgent": { alias: "xy-director", name: "小鱼导演规划" },
  "productionAgent:storyboardGenAgent": { alias: "xy-director", name: "小鱼分镜生成" },
  "productionAgent:storyboardPanelAgent": { alias: "xy-director", name: "小鱼分镜面板" },
  "productionAgent:storyboardTableAgent": { alias: "xy-director", name: "小鱼分镜表格" },
};

async function upsertSetting(key: string, value: string): Promise<void> {
  const existing = await u.db("o_setting").where({ key }).first();
  if (existing) {
    await u.db("o_setting").where({ key }).update({ value });
  } else {
    await u.db("o_setting").insert({ key, value });
  }
}

export async function getXiaoyuDeviceId(): Promise<string> {
  const existing = await u.db("o_setting").where({ key: "xiaoyuDeviceId" }).first();
  if (existing?.value) return String(existing.value);
  const deviceId = `xydev_${crypto.randomUUID()}`;
  await upsertSetting("xiaoyuDeviceId", deviceId);
  return deviceId;
}

export async function getXiaoyuDeviceName(): Promise<string> {
  return `${os.hostname()} · ${process.platform}`;
}

export async function bootstrapXiaoyu(): Promise<void> {
  if (XIAOYU_BRAND.computeCenterUrl.includes("__XIAOYU_")) {
    throw new Error("小鱼智算中心地址尚未在构建时写入，拒绝以未配置状态启动");
  }

  const current = await u.db("o_vendorConfig").where({ id: XIAOYU_BRAND.vendorId }).first();
  const currentValues = current?.inputValues ? JSON.parse(String(current.inputValues)) : {};
  const credentialState = migrateXiaoyuCredential(currentValues);
  const qualitySetting = await u.db("o_setting").where({ key: "xiaoyuQualityMode" }).first();
  const policySetting = await u.db("o_setting").where({ key: "xiaoyuPolicyVersion" }).first();
  const qualityMode = String(qualitySetting?.value || currentValues.qualityMode || XIAOYU_BRAND.defaultQualityMode);
  const policyVersion = String(policySetting?.value || currentValues.policyVersion || "");
  const inputValues = {
    apiKey: "",
    credential: credentialState.credential,
    baseUrl: XIAOYU_BRAND.computeCenterUrl,
    qualityMode,
    policyVersion,
    productId: XIAOYU_BRAND.productId,
    projectRef: String(currentValues.projectRef || ""),
  };

  // 默认由小鱼智算中心统一路由。技术服务人员未来可将 xiaoyuRouteMode 设为 technical，
  // 用于客户本地模型部署；普通用户界面不暴露该开关。
  const routeModeSetting = await u.db("o_setting").where({ key: "xiaoyuRouteMode" }).first();
  const routeMode = String(routeModeSetting?.value || "compute-center");
  if (!routeModeSetting) await upsertSetting("xiaoyuRouteMode", routeMode);
  if (routeMode !== "technical") {
    await u.db("o_vendorConfig").whereNot({ id: XIAOYU_BRAND.vendorId }).update({ enable: 0 });
  }
  if (current) {
    await u.db("o_vendorConfig")
      .where({ id: XIAOYU_BRAND.vendorId })
      .update({ enable: 1, inputValues: JSON.stringify(inputValues), models: current.models || "[]" });
  } else {
    await u.db("o_vendorConfig").insert({
      id: XIAOYU_BRAND.vendorId,
      enable: 1,
      inputValues: JSON.stringify(inputValues),
      models: "[]",
    });
  }

  await upsertSetting("xiaoyuQualityMode", qualityMode);
  await upsertSetting("xiaoyuPolicyVersion", policyVersion);
  await getXiaoyuDeviceId();

  if (routeMode !== "technical") {
    await upsertSetting("agentUseMode", "1");
    for (const [key, config] of Object.entries(modelByAgentKey)) {
      await u.db("o_agentDeploy").where({ key }).update({
        vendorId: XIAOYU_BRAND.vendorId,
        model: config.name,
        modelName: `${XIAOYU_BRAND.vendorId}:${config.alias}`,
      });
    }
  }
}
