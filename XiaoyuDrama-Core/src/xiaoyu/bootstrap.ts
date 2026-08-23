import crypto from "node:crypto";
import os from "node:os";
import db from "@/utils/db";
import { XIAOYU_BRAND } from "./brand";
import { migrateXiaoyuCredential } from "./secureCredential";
import { ensureXiaoyuPipelineSchema } from "./pipeline/database";
import { xiaoyuPipelineEngine } from "./pipeline/engine";

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
  const existing = await db("o_setting").where({ key }).first();
  if (existing) await db("o_setting").where({ key }).update({ value });
  else await db("o_setting").insert({ key, value });
}

export async function getXiaoyuDeviceId(): Promise<string> {
  const existing = await db("o_setting").where({ key: "xiaoyuDeviceId" }).first();
  if (existing?.value) return String(existing.value);
  const deviceId = `xydev_${crypto.randomUUID()}`;
  await upsertSetting("xiaoyuDeviceId", deviceId);
  return deviceId;
}

export async function getXiaoyuDeviceName(): Promise<string> {
  return `${os.hostname()} · ${process.platform}`;
}

export async function activateXiaoyuComputeCenterBindings(): Promise<void> {
  await upsertSetting("xiaoyuComputeCenterEnabled", "1");
  await db("o_vendorConfig").where({ id: XIAOYU_BRAND.vendorId }).update({ enable: 1 });
}

export async function deactivateXiaoyuComputeCenterBindings(): Promise<void> {
  await upsertSetting("xiaoyuComputeCenterEnabled", "0");
  await db("o_vendorConfig").where({ id: XIAOYU_BRAND.vendorId }).update({ enable: 0 });
}

async function cleanupLegacyAutoBindings(): Promise<void> {
  const migrated = await db("o_setting").where({ key: "xiaoyuProviderOnlyMigrationV1" }).first();
  if (String(migrated?.value || "") === "1") return;
  for (const [key, config] of Object.entries(modelByAgentKey)) {
    const row = await db("o_agentDeploy").where({ key }).first();
    const legacyModelName = `${XIAOYU_BRAND.vendorId}:${config.alias}`;
    if (String(row?.vendorId || "") === XIAOYU_BRAND.vendorId && String(row?.modelName || "") === legacyModelName) {
      await db("o_agentDeploy").where({ key }).update({ vendorId: null, model: "", modelName: "" });
    }
  }
  await upsertSetting("xiaoyuProviderOnlyMigrationV1", "1");
}

type XiaoyuBootstrapRuntimeState = typeof globalThis & { __xiaoyuBootstrapPromise?: Promise<void> };
const xiaoyuBootstrapRuntimeState = globalThis as XiaoyuBootstrapRuntimeState;

async function bootstrapXiaoyuInternal(): Promise<void> {
  await ensureXiaoyuPipelineSchema();
  await cleanupLegacyAutoBindings();
  const legacyVendorId = ["to", "on", "flow"].join("");
  await db("o_vendorConfig").whereIn("id", [legacyVendorId, "xiaoyu_ai_drama"]).delete();

  const current = await db("o_vendorConfig").where({ id: XIAOYU_BRAND.vendorId }).first();
  let currentValues: Record<string, any> = {};
  try { currentValues = current?.inputValues ? JSON.parse(String(current.inputValues)) : {}; }
  catch { currentValues = {}; }

  let credentialState: { credential: string; migrated: boolean } = { credential: "", migrated: false };
  let credentialError = "";
  try {
    credentialState = migrateXiaoyuCredential(currentValues);
  } catch (exception) {
    credentialError = exception instanceof Error ? exception.message : String(exception);
    console.warn(`[xiaoyu] 智算中心凭据不可用，已禁用该可选 Provider：${credentialError}`);
    await upsertSetting("xiaoyuComputeCenterEnabled", "0");
  }

  const qualitySetting = await db("o_setting").where({ key: "xiaoyuQualityMode" }).first();
  const defaultQualityMode = String(qualitySetting?.value || currentValues.defaultQualityMode || currentValues.qualityMode || XIAOYU_BRAND.defaultQualityMode);
  const baseUrl = String(currentValues.baseUrl || "").replace(/\/+$/, "");
  const configured = Boolean(baseUrl && credentialState.credential);
  const enabledSetting = await db("o_setting").where({ key: "xiaoyuComputeCenterEnabled" }).first();
  const explicitlyEnabled = !credentialError && String(enabledSetting?.value || "0") === "1";
  const inputValues = { credential: credentialState.credential, baseUrl, defaultQualityMode, productId: XIAOYU_BRAND.productId };

  if (current) {
    await db("o_vendorConfig").where({ id: XIAOYU_BRAND.vendorId }).update({
      enable: configured && explicitlyEnabled ? 1 : 0,
      inputValues: JSON.stringify(inputValues),
      models: current.models || "[]",
    });
  } else {
    await db("o_vendorConfig").insert({ id: XIAOYU_BRAND.vendorId, enable: 0, inputValues: JSON.stringify(inputValues), models: "[]" });
  }

  await upsertSetting("xiaoyuQualityMode", defaultQualityMode);
  if (!enabledSetting) await upsertSetting("xiaoyuComputeCenterEnabled", "0");
  await getXiaoyuDeviceId();
  if (configured && explicitlyEnabled) await activateXiaoyuComputeCenterBindings();
  await xiaoyuPipelineEngine.start();
}

export function bootstrapXiaoyu(): Promise<void> {
  if (!xiaoyuBootstrapRuntimeState.__xiaoyuBootstrapPromise) {
    xiaoyuBootstrapRuntimeState.__xiaoyuBootstrapPromise = bootstrapXiaoyuInternal().catch((error) => {
      delete xiaoyuBootstrapRuntimeState.__xiaoyuBootstrapPromise;
      throw error;
    });
  }
  return xiaoyuBootstrapRuntimeState.__xiaoyuBootstrapPromise;
}
