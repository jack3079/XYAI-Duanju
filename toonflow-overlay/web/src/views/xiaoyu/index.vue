<template>
  <div class="compute-page">
    <section class="hero">
      <div>
        <div class="eyebrow">小鱼Ai短剧生成系统</div>
        <h1>小鱼智算中心</h1>
        <p>所有模型、参数、重试和质量检查由系统自动完成。您只需要选择质量模式。</p>
      </div>
      <div class="support-card">
        <span>帮助与充值客服微信</span>
        <strong>{{ supportWechat }}</strong>
        <t-button size="small" variant="outline" @click="copyWechat">复制微信号</t-button>
      </div>
    </section>

    <t-loading :loading="loading" show-overlay>
      <section v-if="!loggedIn" class="login-panel">
        <div class="panel-title">登录后开始生成短剧</div>
        <div class="panel-subtitle">普通用户无需填写模型名称、API 地址或密钥。</div>
        <t-form :data="loginForm" label-align="top" @submit="handleLogin">
          <t-form-item label="账号" name="username">
            <t-input v-model="loginForm.username" autocomplete="username" placeholder="请输入小鱼智算中心账号" clearable />
          </t-form-item>
          <t-form-item label="密码" name="password">
            <t-input v-model="loginForm.password" type="password" autocomplete="current-password" placeholder="请输入密码" clearable />
          </t-form-item>
          <t-button theme="primary" type="submit" block :loading="loggingIn">登录小鱼智算中心</t-button>
        </t-form>
        <div class="contact-tip">没有账号、余额不足或需要充值，请联系微信：{{ supportWechat }}</div>
      </section>

      <template v-else>
        <section class="account-strip">
          <div>
            <span class="label">当前账号</span>
            <strong>{{ account?.username }}</strong>
          </div>
          <div>
            <span class="label">可用小鱼算力点</span>
            <strong class="balance">{{ formatBalance(account?.balance_points) }}</strong>
          </div>
          <div class="account-actions">
            <t-button variant="outline" @click="refreshAccount">刷新余额</t-button>
            <t-button variant="text" theme="default" @click="handleLogout">退出智算中心</t-button>
          </div>
        </section>

        <section class="quality-section">
          <div class="section-heading">
            <div>
              <h2>生成质量</h2>
              <p>选择后对后续剧本、角色、分镜、图片、视频和配音任务统一生效。</p>
            </div>
            <div class="active-badge">当前：{{ selectedModeName }}</div>
          </div>

          <div class="mode-grid">
            <button
              v-for="mode in modes"
              :key="mode.id"
              type="button"
              class="mode-card"
              :class="{ selected: selectedMode === mode.id, economy: mode.id === 'economy', unavailable: !mode.production_ready }"
              :disabled="savingMode || !mode.production_ready"
              @click="changeMode(mode.id)">
              <div class="mode-topline">
                <span class="radio-dot"></span>
                <strong>{{ mode.name }}</strong>
                <span v-if="mode.default" class="recommend">默认推荐</span>
                <span v-if="!mode.production_ready" class="not-ready">暂不可生产</span>
              </div>
              <p>{{ mode.description }}</p>
              <div class="warning">{{ mode.warning }}</div>
              <div v-if="!mode.production_ready" class="missing">
                缺少：{{ unavailableText(mode) }}
              </div>
              <div v-else-if="mode.degraded_capabilities.length" class="degraded">
                {{ mode.degraded_capabilities.length }} 个环节当前只有一条线路
              </div>
              <div class="strategy">策略版本：{{ mode.strategy_version }}</div>
            </button>
          </div>
        </section>

        <section class="principles">
          <div class="principle">
            <strong>专业能力不缩水</strong>
            <span>剧本 Agent、角色资产、导演分镜和生产工作台全部保留。</span>
          </div>
          <div class="principle">
            <strong>配置由系统承担</strong>
            <span>真实模型和供应商由小鱼智算中心动态组合，客户端不暴露技术参数。</span>
          </div>
          <div class="principle">
            <strong>失败按规则退款</strong>
            <span>异步任务先冻结算力点，成功结算，失败自动退回。</span>
          </div>
        </section>
      </template>
    </t-loading>
  </div>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import { MessagePlugin } from "tdesign-vue-next";

type QualityMode = "quality" | "standard" | "economy";

interface Account {
  username: string;
  product_id: string;
  balance_points: number;
  support_wechat: string;
}

interface ModeInfo {
  id: QualityMode;
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

const supportWechat = "echo169369";
const loading = ref(true);
const loggingIn = ref(false);
const savingMode = ref(false);
const loggedIn = ref(false);
const account = ref<Account | null>(null);
const modes = ref<ModeInfo[]>([]);
const selectedMode = ref<QualityMode>("standard");
const selectedPolicyVersion = ref("");
const loginForm = reactive({ username: "", password: "" });

const selectedModeName = computed(() => modes.value.find((item) => item.id === selectedMode.value)?.name || "标准模式");

function unavailableText(mode: ModeInfo): string {
  const capabilities = [...mode.missing_capabilities, ...mode.temporarily_unavailable_capabilities];
  return capabilities.length ? capabilities.join("、") : "模型渠道配置";
}

function unwrap<T>(response: any): T {
  if (response?.code !== 200) throw new Error(response?.message || "请求失败");
  return response.data as T;
}

function formatBalance(value: number | undefined): string {
  return Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

async function copyWechat() {
  try {
    await navigator.clipboard.writeText(supportWechat);
    MessagePlugin.success("客服微信已复制");
  } catch {
    MessagePlugin.info(`客服微信：${supportWechat}`);
  }
}

async function loadModes() {
  const response = await axios.get("/xiaoyu/compute-center/quality-modes");
  const data = unwrap<{ modes: ModeInfo[]; selected: QualityMode; policyVersion: string }>(response);
  modes.value = data.modes;
  selectedMode.value = data.selected;
  selectedPolicyVersion.value = data.policyVersion || data.modes.find((item) => item.id === data.selected)?.strategy_version || "";
}

async function refreshAccount() {
  const response = await axios.get("/xiaoyu/compute-center/account");
  account.value = unwrap<Account>(response);
}

async function loadStatus() {
  loading.value = true;
  try {
    const response = await axios.get("/xiaoyu/compute-center/status");
    const data = unwrap<{ loggedIn: boolean; account?: Account }>(response);
    loggedIn.value = data.loggedIn;
    account.value = data.account || null;
    if (data.loggedIn) await loadModes();
  } catch (error: any) {
    loggedIn.value = false;
    account.value = null;
    MessagePlugin.error(error?.message || "无法连接小鱼智算中心");
  } finally {
    loading.value = false;
  }
}

async function handleLogin() {
  if (!loginForm.username.trim() || loginForm.password.length < 8) {
    MessagePlugin.warning("请输入正确的账号和密码");
    return;
  }
  loggingIn.value = true;
  try {
    const response = await axios.post("/xiaoyu/compute-center/login", loginForm);
    const data = unwrap<{ account: Account; modes: ModeInfo[]; qualityMode: QualityMode; policyVersion: string }>(response);
    account.value = data.account;
    modes.value = data.modes;
    selectedMode.value = data.qualityMode;
    selectedPolicyVersion.value = data.policyVersion;
    loggedIn.value = true;
    loginForm.password = "";
    MessagePlugin.success("已登录小鱼智算中心");
  } catch (error: any) {
    MessagePlugin.error(error?.message || "登录失败");
  } finally {
    loggingIn.value = false;
  }
}

async function handleLogout() {
  try {
    await axios.post("/xiaoyu/compute-center/logout");
  } finally {
    loggedIn.value = false;
    account.value = null;
    modes.value = [];
    MessagePlugin.success("已退出小鱼智算中心");
  }
}

async function changeMode(mode: QualityMode) {
  if (mode === selectedMode.value) return;
  savingMode.value = true;
  try {
    const response = await axios.post("/xiaoyu/compute-center/quality-mode", { mode });
    const data = unwrap<{ selected: QualityMode; policyVersion: string }>(response);
    selectedMode.value = data.selected;
    selectedPolicyVersion.value = data.policyVersion;
    MessagePlugin.success(`已切换为${selectedModeName.value}`);
  } catch (error: any) {
    MessagePlugin.error(error?.message || "质量模式切换失败");
  } finally {
    savingMode.value = false;
  }
}

onMounted(loadStatus);
</script>

<style scoped lang="scss">
.compute-page {
  min-height: 100%;
  padding: 24px 0 40px;
  color: var(--td-text-color-primary);
}

.hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 24px;
  padding: 28px;
  border-radius: 20px;
  background: linear-gradient(135deg, var(--td-brand-color-1), var(--td-bg-color-container));
  border: 1px solid var(--td-brand-color-3);

  .eyebrow {
    color: var(--td-brand-color);
    font-weight: 600;
    margin-bottom: 8px;
  }

  h1 {
    margin: 0;
    font-size: 32px;
  }

  p {
    margin: 12px 0 0;
    color: var(--td-text-color-secondary);
    max-width: 680px;
    line-height: 1.7;
  }
}

.support-card {
  min-width: 230px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 8px;
  padding: 18px;
  border-radius: 16px;
  background: var(--td-bg-color-container);
  box-shadow: var(--td-shadow-1);

  span { color: var(--td-text-color-secondary); font-size: 13px; }
  strong { font-size: 22px; letter-spacing: 0.5px; }
}

.login-panel {
  width: min(460px, 100%);
  margin: 48px auto;
  padding: 28px;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 18px;
  box-shadow: var(--td-shadow-1);
}

.panel-title { font-size: 22px; font-weight: 700; }
.panel-subtitle { margin: 8px 0 24px; color: var(--td-text-color-secondary); }
.contact-tip { margin-top: 18px; color: var(--td-text-color-secondary); text-align: center; font-size: 13px; }

.account-strip {
  margin-top: 20px;
  padding: 20px 24px;
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  align-items: center;
  gap: 24px;
  border-radius: 16px;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);

  > div:not(.account-actions) { display: flex; flex-direction: column; gap: 7px; }
  .label { color: var(--td-text-color-secondary); font-size: 13px; }
  strong { font-size: 18px; }
  .balance { color: var(--td-brand-color); font-size: 28px; }
}

.account-actions { display: flex; gap: 8px; }
.quality-section { margin-top: 28px; }
.section-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
.section-heading h2 { margin: 0; font-size: 24px; }
.section-heading p { margin: 8px 0 0; color: var(--td-text-color-secondary); }
.active-badge { padding: 7px 12px; border-radius: 999px; background: var(--td-brand-color-1); color: var(--td-brand-color); font-weight: 600; }

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 18px;
}

.mode-card {
  min-height: 220px;
  padding: 22px;
  text-align: left;
  border: 1px solid var(--td-component-border);
  border-radius: 18px;
  background: var(--td-bg-color-container);
  color: inherit;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;

  &:hover { transform: translateY(-2px); border-color: var(--td-brand-color-5); box-shadow: var(--td-shadow-2); }
  &.selected { border: 2px solid var(--td-brand-color); background: var(--td-brand-color-1); }
  &.economy .warning { color: var(--td-warning-color); }
  &.unavailable { border-style: dashed; background: var(--td-bg-color-secondarycontainer); }
  &:disabled { cursor: not-allowed; opacity: 0.68; transform: none; box-shadow: none; }

  p { min-height: 72px; margin: 18px 0 12px; line-height: 1.65; color: var(--td-text-color-secondary); }
  .warning { min-height: 42px; font-weight: 600; }
  .strategy { margin-top: 16px; font-size: 12px; color: var(--td-text-color-placeholder); }
}

.mode-topline { display: flex; align-items: center; gap: 10px; }
.mode-topline strong { font-size: 19px; }
.radio-dot { width: 16px; height: 16px; border: 2px solid var(--td-border-level-2-color); border-radius: 50%; }
.selected .radio-dot { border: 5px solid var(--td-brand-color); }
.recommend { margin-left: auto; padding: 3px 8px; border-radius: 999px; background: var(--td-success-color-1); color: var(--td-success-color); font-size: 12px; }
.not-ready { margin-left: auto; padding: 3px 8px; border-radius: 999px; background: var(--td-error-color-1); color: var(--td-error-color); font-size: 12px; }
.missing { margin-top: 10px; color: var(--td-error-color); font-size: 12px; line-height: 1.5; }
.degraded { margin-top: 10px; color: var(--td-warning-color); font-size: 12px; }

.principles {
  margin-top: 28px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.principle {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border-radius: 14px;
  background: var(--td-bg-color-secondarycontainer);
  span { color: var(--td-text-color-secondary); line-height: 1.6; }
}

@media (max-width: 900px) {
  .hero { flex-direction: column; }
  .support-card { min-width: 0; }
  .mode-grid, .principles { grid-template-columns: 1fr; }
  .account-strip { grid-template-columns: 1fr; }
  .account-actions { justify-content: flex-start; }
}
</style>
