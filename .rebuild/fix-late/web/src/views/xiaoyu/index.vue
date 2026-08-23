<template>
  <div class="compute-page">
    <section class="hero">
      <div>
        <div class="eyebrow">模型服务</div>
        <h1>小鱼智算中心 API</h1>
        <p>短剧系统与小鱼智算中心是两个独立系统。安装短剧系统不绑定任何智算中心；需要 AI 能力时，再像配置 OpenAI API Key 一样粘贴 API Token。</p>
      </div>
      <div class="support-card">
        <span>API Token / 充值 / 部署</span>
        <strong>{{ supportWechat }}</strong>
        <t-button size="small" variant="outline" @click="copyWechat">复制微信号</t-button>
      </div>
    </section>

    <t-loading :loading="loading" show-overlay>
      <section v-if="!configured" class="connect-grid">
        <article class="panel">
          <div class="panel-title">手动配置</div>
          <div class="panel-subtitle">先在小鱼智算中心签发产品 <code>xiaoyu-drama</code> 的 API Token，再填到这里。</div>
          <t-form :data="form" label-align="top" @submit="connect">
            <t-form-item label="小鱼智算中心 API 地址">
              <t-input v-model="form.baseUrl" placeholder="本机：http://127.0.0.1:19090；公网必须 HTTPS" clearable />
            </t-form-item>
            <t-form-item label="API Token">
              <t-input v-model="form.apiToken" type="password" autocomplete="off" placeholder="xya_..." clearable />
            </t-form-item>
            <t-button theme="primary" type="submit" block :loading="saving">验证并启用</t-button>
          </t-form>
        </article>
        <article class="panel">
          <div class="panel-title">一键配置</div>
          <div class="panel-subtitle">在小鱼智算中心复制“一键配置”，粘贴下面即可，不需要分别填写地址和 Token。</div>
          <t-textarea v-model="oneClickConfig" :autosize="{ minRows: 7, maxRows: 12 }" placeholder="xycc1:... 或 JSON 配置" />
          <t-button class="import-button" variant="outline" block :loading="saving" @click="importConfig">导入并验证</t-button>
          <div class="note">Token 仅加密保存在当前电脑；短剧系统卸载/断开配置不会自动撤销智算中心里的 Token。</div>
        </article>
      </section>
      <template v-else>
        <section class="account-strip">
          <div><span class="label">接口状态</span><strong class="connected">已连接</strong></div>
          <div><span class="label">API 地址</span><strong class="mono">{{ baseUrl }}</strong></div>
          <div><span class="label">账号</span><strong>{{ account?.username || "已验证 Token" }}</strong></div>
          <div><span class="label">可用小鱼算力点</span><strong class="balance">{{ formatBalance(account?.balance_points) }}</strong></div>
          <div class="account-actions"><t-button variant="outline" @click="refresh">重新验证</t-button><t-button variant="text" theme="danger" @click="disconnect">移除本机配置</t-button></div>
        </section>
        <section class="quality-section">
          <div class="section-heading"><div><h2>默认生成质量</h2><p>这里只决定新任务默认档位，不会覆盖用户自行配置的文本、图片或视频模型。</p></div><div class="active-badge">当前：{{ selectedModeName }}</div></div>
          <div class="mode-grid">
            <button v-for="mode in modes" :key="mode.id" type="button" class="mode-card" :class="{ selected: selectedMode === mode.id, unavailable: !mode.production_ready }" :disabled="savingMode || !mode.production_ready" @click="changeMode(mode.id)">
              <div class="mode-topline"><span class="radio-dot"></span><strong>{{ mode.name }}</strong><span v-if="mode.default" class="recommend">默认推荐</span><span v-if="!mode.production_ready" class="not-ready">暂不可生产</span></div>
              <p>{{ mode.description }}</p><div class="warning">{{ mode.warning }}</div><div v-if="!mode.production_ready" class="missing">缺少：{{ unavailableText(mode) }}</div><div class="strategy">策略版本：{{ mode.strategy_version }}</div>
            </button>
          </div>
        </section>
      </template>
    </t-loading>
  </div>
</template>
<script setup lang="ts">
import axios from "@/utils/axios";
import { DialogPlugin, MessagePlugin } from "tdesign-vue-next";
type QualityMode = "quality" | "standard" | "economy";
interface Account { username: string; product_id: string; balance_points: number; support_wechat: string }
interface ModeInfo { id: QualityMode; name: string; description: string; warning: string; strategy_version: string; production_ready: boolean; missing_capabilities: string[]; temporarily_unavailable_capabilities: string[]; degraded_capabilities: string[]; default: boolean }
interface Status { configured: boolean; enabled: boolean; baseUrl: string; productId: string; account?: Account; qualityMode?: QualityMode; modes?: ModeInfo[] }
const supportWechat = "echo169369"; const loading=ref(true); const saving=ref(false); const savingMode=ref(false); const configured=ref(false); const baseUrl=ref(""); const account=ref<Account|null>(null); const modes=ref<ModeInfo[]>([]); const selectedMode=ref<QualityMode>("standard"); const form=reactive({baseUrl:"http://127.0.0.1:19090",apiToken:""}); const oneClickConfig=ref("");
const selectedModeName=computed(()=>modes.value.find(i=>i.id===selectedMode.value)?.name||"标准模式");
function unwrap<T>(r:any):T{if(r?.code!==200)throw new Error(r?.message||"请求失败");return r.data as T} function formatBalance(v:number|undefined){return Number(v||0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:4})} function unavailableText(m:ModeInfo){return [...(m.missing_capabilities||[]),...(m.temporarily_unavailable_capabilities||[])].join("、")||"模型渠道"}
async function copyWechat(){try{await navigator.clipboard.writeText(supportWechat);MessagePlugin.success("客服微信已复制")}catch{MessagePlugin.info(`客服微信：${supportWechat}`)}}
async function loadStatus(showError=false){loading.value=true;try{const data=unwrap<Status>(await axios.get("/xiaoyu/compute-center/status"));configured.value=Boolean(data.configured&&data.enabled);baseUrl.value=data.baseUrl||"";account.value=data.account||null;modes.value=data.modes||[];selectedMode.value=data.qualityMode||"standard";if(data.baseUrl)form.baseUrl=data.baseUrl}catch(e:any){configured.value=false;if(showError)MessagePlugin.error(e?.message||"模型服务状态读取失败")}finally{loading.value=false}}
async function connect(){if(!form.baseUrl.trim()||!form.apiToken.trim())return MessagePlugin.warning("请输入 API 地址和 API Token");saving.value=true;try{const data=unwrap<Status>(await axios.post("/xiaoyu/compute-center/configure",{baseUrl:form.baseUrl.trim(),apiToken:form.apiToken.trim()}));configured.value=true;baseUrl.value=data.baseUrl;account.value=data.account||null;modes.value=data.modes||[];selectedMode.value=data.qualityMode||"standard";form.apiToken="";MessagePlugin.success("小鱼智算中心 API 已验证并启用")}catch(e:any){MessagePlugin.error(e?.message||"API 配置失败")}finally{saving.value=false}}
async function importConfig(){if(!oneClickConfig.value.trim())return MessagePlugin.warning("请先粘贴一键配置内容");saving.value=true;try{const data=unwrap<Status>(await axios.post("/xiaoyu/compute-center/import-config",{config:oneClickConfig.value.trim()}));configured.value=true;baseUrl.value=data.baseUrl;account.value=data.account||null;modes.value=data.modes||[];selectedMode.value=data.qualityMode||"standard";oneClickConfig.value="";MessagePlugin.success("一键配置已导入")}catch(e:any){MessagePlugin.error(e?.message||"一键配置导入失败")}finally{saving.value=false}}
async function refresh(){await loadStatus(true);if(configured.value)MessagePlugin.success("API Token 验证通过")}
function disconnect(){const dialog=DialogPlugin.confirm({header:"移除本机模型服务配置",body:"只会删除当前电脑保存的 API 地址和 Token，不会撤销智算中心中的 Token，也不会删除任何短剧项目。",confirmBtn:"确认移除",cancelBtn:"取消",onConfirm:async()=>{dialog.destroy();try{await axios.post("/xiaoyu/compute-center/disconnect");configured.value=false;account.value=null;modes.value=[];baseUrl.value="";MessagePlugin.success("本机模型服务配置已移除")}catch(e:any){MessagePlugin.error(e?.message||"移除失败")}}})}
async function changeMode(mode:QualityMode){if(mode===selectedMode.value)return;savingMode.value=true;try{unwrap(await axios.post("/xiaoyu/compute-center/quality-mode",{mode}));selectedMode.value=mode;MessagePlugin.success(`已切换为${selectedModeName.value}`)}catch(e:any){MessagePlugin.error(e?.message||"质量模式切换失败")}finally{savingMode.value=false}}
onMounted(()=>loadStatus(false));
</script>
<style scoped lang="scss">
.compute-page{min-height:100%;padding:24px 0 40px;color:var(--td-text-color-primary)}.hero{display:flex;justify-content:space-between;gap:24px;padding:28px;border-radius:20px;background:linear-gradient(135deg,var(--td-brand-color-1),var(--td-bg-color-container));border:1px solid var(--td-brand-color-3)}.eyebrow{color:var(--td-brand-color);font-weight:700;margin-bottom:8px}h1{margin:0;font-size:32px}.hero p{margin:12px 0 0;color:var(--td-text-color-secondary);max-width:760px;line-height:1.7}.support-card{min-width:240px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:8px;padding:18px;border-radius:16px;background:var(--td-bg-color-container);box-shadow:var(--td-shadow-1)}.connect-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}.panel{padding:26px;background:var(--td-bg-color-container);border:1px solid var(--td-component-border);border-radius:18px}.account-strip{margin-top:20px;padding:20px 24px;display:grid;grid-template-columns:.7fr 1.4fr 1fr 1fr auto;align-items:center;gap:20px;border-radius:16px;background:var(--td-bg-color-container);border:1px solid var(--td-component-border)}.quality-section{margin-top:28px}.mode-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:18px}.mode-card{min-height:210px;padding:22px;text-align:left;border:1px solid var(--td-component-border);border-radius:18px;background:var(--td-bg-color-container);color:inherit;cursor:pointer}.mode-card.selected{border:2px solid var(--td-brand-color);background:var(--td-brand-color-1)}@media(max-width:1000px){.connect-grid{grid-template-columns:1fr}.account-strip{grid-template-columns:1fr 1fr}.mode-grid{grid-template-columns:1fr}.hero{flex-direction:column}}
</style>
