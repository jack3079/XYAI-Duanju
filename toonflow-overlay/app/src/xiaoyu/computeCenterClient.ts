import u from "@/utils";
import { XIAOYU_BRAND, type XiaoyuQualityMode } from "./brand";
import { getXiaoyuDeviceId, getXiaoyuDeviceName } from "./bootstrap";
import { decryptXiaoyuCredential, encryptXiaoyuCredential, migrateXiaoyuCredential } from "./secureCredential";

interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

interface VendorInputs {
  apiKey: string;
  credential: string;
  baseUrl: string;
  qualityMode: XiaoyuQualityMode;
  policyVersion: string;
  productId: string;
  projectRef: string;
}

export interface XiaoyuAccount {
  username: string;
  product_id: string;
  balance_points: number;
  support_wechat: string;
}

export interface XiaoyuQualityModeInfo {
  id: XiaoyuQualityMode;
  name: string;
  description: string;
  warning: string;
  strategy_version: string;
  production_ready: boolean;
  missing_capabilities: string[];
  temporarily_unavailable_capabilities: string[];
  degraded_capabilities: string[];
  default: boolean;
}

export interface XiaoyuProductionPolicy {
  product_id: string;
  quality_mode: XiaoyuQualityMode;
  name: string;
  description: string;
  warning: string;
  policy_version: string;
  production_ready: boolean;
  required_capabilities: string[];
  available_capabilities: string[];
  missing_capabilities: string[];
  temporarily_unavailable_capabilities: string[];
  degraded_capabilities: string[];
}

export interface XiaoyuEstimateItem {
  capability: string;
  input?: Record<string, unknown>;
  quantity?: number;
}

export interface XiaoyuEstimate {
  product_id: string;
  quality_mode: XiaoyuQualityMode;
  policy_version: string;
  min_points: number;
  max_points: number;
  balance_points: number;
  balance_sufficient: boolean;
  missing_capabilities: string[];
  breakdown: Array<{
    capability: string;
    quantity: number;
    available: boolean;
    min_points: number;
    max_points: number;
  }>;
  support_wechat: string;
}

async function getInputs(): Promise<VendorInputs> {
  const row = await u.db("o_vendorConfig").where({ id: XIAOYU_BRAND.vendorId }).first();
  if (!row) throw new Error("小鱼智算中心尚未初始化");
  const values = JSON.parse(String(row.inputValues || "{}"));
  const migrated = migrateXiaoyuCredential(values);
  if (migrated.migrated) {
    await u.db("o_vendorConfig")
      .where({ id: XIAOYU_BRAND.vendorId })
      .update({ inputValues: JSON.stringify({ ...values, apiKey: "", credential: migrated.credential }) });
  }
  return {
    apiKey: decryptXiaoyuCredential(migrated.credential),
    credential: migrated.credential,
    baseUrl: String(values.baseUrl || XIAOYU_BRAND.computeCenterUrl).replace(/\/+$/, ""),
    qualityMode: (values.qualityMode || XIAOYU_BRAND.defaultQualityMode) as XiaoyuQualityMode,
    policyVersion: String(values.policyVersion || ""),
    productId: String(values.productId || XIAOYU_BRAND.productId),
    projectRef: String(values.projectRef || ""),
  };
}

async function saveInputs(patch: Partial<VendorInputs>): Promise<VendorInputs> {
  const current = await getInputs();
  const nextApiKey = patch.apiKey !== undefined ? patch.apiKey : current.apiKey;
  const next: VendorInputs = {
    ...current,
    ...patch,
    apiKey: nextApiKey,
    credential: patch.apiKey !== undefined ? encryptXiaoyuCredential(nextApiKey) : current.credential,
    baseUrl: XIAOYU_BRAND.computeCenterUrl,
    productId: XIAOYU_BRAND.productId,
  };
  const stored = { ...next, apiKey: "" };
  await u.db("o_vendorConfig")
    .where({ id: XIAOYU_BRAND.vendorId })
    .update({ inputValues: JSON.stringify(stored), enable: 1 });
  if (patch.qualityMode) await upsertSetting("xiaoyuQualityMode", patch.qualityMode);
  if (patch.policyVersion !== undefined) await upsertSetting("xiaoyuPolicyVersion", patch.policyVersion);
  return next;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const row = await u.db("o_setting").where({ key }).first();
  if (row) await u.db("o_setting").where({ key }).update({ value });
  else await u.db("o_setting").insert({ key, value });
}

async function clearStoredCredential(): Promise<void> {
  const row = await u.db("o_vendorConfig").where({ id: XIAOYU_BRAND.vendorId }).first();
  if (!row) return;
  let values: Record<string, unknown> = {};
  try {
    values = JSON.parse(String(row.inputValues || "{}"));
  } catch {
    // 本地配置损坏时仍允许退出并清除凭据。
  }
  await u.db("o_vendorConfig")
    .where({ id: XIAOYU_BRAND.vendorId })
    .update({ inputValues: JSON.stringify({ ...values, apiKey: "", credential: "", projectRef: "" }), enable: 1 });
}

async function request<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; requireAuth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const inputs = await getInputs();
  if (options.requireAuth !== false && !inputs.apiKey) {
    throw new Error(`请先登录${XIAOYU_BRAND.computeCenterName}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);
  try {
    const response = await fetch(`${inputs.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(inputs.apiKey ? { Authorization: `Bearer ${inputs.apiKey}` } : {}),
        "X-Xiaoyu-Product": XIAOYU_BRAND.productId,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error(`小鱼智算中心返回了无法解析的数据（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      const message = payload?.detail || payload?.message || `HTTP ${response.status}`;
      throw new Error(String(message));
    }
    const envelope = payload as ApiEnvelope<T>;
    if (typeof envelope?.code === "number" && envelope.code !== 200) {
      throw new Error(envelope.message || "小鱼智算中心请求失败");
    }
    return envelope?.data ?? payload;
  } catch (exception: any) {
    if (exception?.name === "AbortError") throw new Error("连接小鱼智算中心超时，请检查网络后重试");
    throw exception;
  } finally {
    clearTimeout(timer);
  }
}

export async function loginXiaoyu(username: string, password: string): Promise<XiaoyuAccount> {
  const data = await request<{
    api_token: string;
    username: string;
    product_id: string;
    balance_points: number;
    default_quality_mode: XiaoyuQualityMode;
    default_policy_version: string;
    default_mode_ready: boolean;
    support_wechat: string;
  }>("/v1/auth/login", {
    method: "POST",
    requireAuth: false,
    body: {
      username,
      password,
      product_id: XIAOYU_BRAND.productId,
      device_id: await getXiaoyuDeviceId(),
      device_name: await getXiaoyuDeviceName(),
    },
  });
  await saveInputs({
    apiKey: data.api_token,
    qualityMode: data.default_quality_mode || "standard",
    policyVersion: data.default_policy_version || "",
    projectRef: "",
  });
  return {
    username: data.username,
    product_id: data.product_id,
    balance_points: data.balance_points,
    support_wechat: data.support_wechat,
  };
}

export async function logoutXiaoyu(): Promise<void> {
  try {
    if ((await getInputs()).apiKey) await request("/v1/auth/logout", { method: "POST" });
  } finally {
    await clearStoredCredential();
  }
}

export async function getXiaoyuAccount(): Promise<XiaoyuAccount> {
  return request<XiaoyuAccount>("/v1/account");
}

export async function getXiaoyuQualityModes(): Promise<XiaoyuQualityModeInfo[]> {
  return request<XiaoyuQualityModeInfo[]>("/v1/quality-modes");
}

export async function getSelectedQualityMode(): Promise<XiaoyuQualityMode> {
  return (await getInputs()).qualityMode;
}

export async function getSelectedPolicyVersion(): Promise<string> {
  return (await getInputs()).policyVersion;
}

export async function selectQualityMode(mode: XiaoyuQualityMode): Promise<XiaoyuQualityModeInfo> {
  const modes = await getXiaoyuQualityModes();
  const selected = modes.find((item) => item.id === mode);
  if (!selected) throw new Error("所选质量模式当前不存在");
  if (!selected.production_ready) {
    const missing = [...selected.missing_capabilities, ...selected.temporarily_unavailable_capabilities];
    throw new Error(`所选模式暂不可生产，缺少能力：${missing.join("、") || "模型渠道不可用"}`);
  }
  await saveInputs({ qualityMode: mode, policyVersion: selected.strategy_version, projectRef: "" });
  return selected;
}

export async function getProductionPolicy(
  mode: XiaoyuQualityMode,
  version?: string,
): Promise<XiaoyuProductionPolicy> {
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  return request<XiaoyuProductionPolicy>(`/v1/production-policy/${mode}${query}`);
}

export async function estimateProduction(
  mode: XiaoyuQualityMode,
  policyVersion: string | undefined,
  items: XiaoyuEstimateItem[],
): Promise<XiaoyuEstimate> {
  return request<XiaoyuEstimate>("/v1/estimate", {
    method: "POST",
    body: {
      quality_mode: mode,
      policy_version: policyVersion || undefined,
      items: items.map((item) => ({
        capability: item.capability,
        input: item.input || {},
        quantity: item.quantity || 1,
      })),
    },
  });
}

export async function setProjectQualityContext(
  projectRef: string,
  mode: XiaoyuQualityMode,
  policyVersion: string,
): Promise<XiaoyuProductionPolicy> {
  if (!projectRef || !policyVersion) throw new Error("项目缺少质量模式或生产策略版本");
  const policy = await getProductionPolicy(mode, policyVersion);
  await saveInputs({ projectRef, qualityMode: mode, policyVersion: policy.policy_version });
  return policy;
}

export async function hasXiaoyuCredential(): Promise<boolean> {
  return Boolean((await getInputs()).apiKey);
}
