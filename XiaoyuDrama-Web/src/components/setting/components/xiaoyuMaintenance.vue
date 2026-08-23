<template>
  <div class="maintenance-page">
    <div class="headline">
      <div><h3>维护、备份与更新</h3><p>升级前自动备份。诊断包会自动脱敏，不包含模型密钥和登录凭据。</p></div>
      <div class="support">客服微信 <strong>{{ supportWechat }}</strong></div>
    </div>
    <t-loading :loading="loading">
      <div class="grid">
        <t-card title="数据保护" bordered>
          <p>备份项目数据库、生成素材、自定义 AI Provider、Skill、Prompt 与本机凭据。Docker 备份会保存在持久化 volume 中并可直接下载。</p>
          <div class="actions"><t-button theme="primary" @click="createBackup">立即备份</t-button><t-button v-if="isElectron" variant="outline" @click="restoreBackup">从备份恢复</t-button></div>
          <div v-if="lastBackup" class="result">最近备份：{{ lastBackup }}</div>
        </t-card>
        <t-card title="远程诊断" bordered>
          <p>生成系统环境、数据库完整性、生产流水线和最近日志的脱敏诊断包。</p>
          <div class="actions"><t-button theme="primary" @click="createDiagnostics">生成诊断包</t-button></div>
          <div v-if="lastDiagnostic" class="result">诊断包：{{ lastDiagnostic }}</div>
        </t-card>
        <t-card title="软件更新" bordered>
          <p>更新清单使用 Ed25519 签名，安装包同时校验 SHA-256 和文件大小。校验失败不会安装。</p>
          <div class="update-state"><span>当前版本：{{ updateState.currentVersion || '-' }}</span><t-tag v-if="updateState.available" theme="warning">发现 {{ updateState.manifest?.version }}</t-tag><t-tag v-else theme="success">{{ updateChecked ? '暂无更新' : '尚未检查' }}</t-tag></div>
          <div class="actions"><t-button variant="outline" @click="checkUpdate">检查更新</t-button><t-button v-if="updateState.available" theme="primary" :loading="downloading" @click="downloadUpdate">下载并校验</t-button><t-button v-if="downloadedFile && isElectron" theme="danger" @click="installUpdate">备份并安装</t-button></div>
          <div v-if="!isElectron" class="notes">Docker 模式请通过拉取新代码/镜像后重新构建升级，不在运行中的容器内安装桌面更新包。</div>
          <div v-if="updateState.manifest?.release_notes" class="notes">{{ updateState.manifest.release_notes }}</div>
        </t-card>
        <t-card title="系统状态" bordered><p>维护目录：{{ status.root || '-' }}</p><p>可用备份：{{ status.backups?.length || 0 }}</p><p>数据库完整性：{{ integrityText }}</p><div class="actions"><t-button variant="outline" @click="refresh">刷新状态</t-button></div></t-card>
      </div>
    </t-loading>
  </div>
</template>
<script setup lang="ts">
import axios from "@/utils/axios";
import { DialogPlugin, MessagePlugin } from "tdesign-vue-next";
import settingStore from "@/stores/setting";
import { storeToRefs } from "pinia";
const supportWechat="echo169369";const{isElectron}=storeToRefs(settingStore());const loading=ref(false);const downloading=ref(false);const updateChecked=ref(false);const lastBackup=ref("");const lastDiagnostic=ref("");const downloadedFile=ref("");const status=ref<any>({root:"",backups:[],databaseIntegrity:null});const updateState=ref<any>({currentVersion:"",available:false,manifest:null});const integrityText=computed(()=>JSON.stringify(status.value.databaseIntegrity||"未知").includes("ok")?"正常":"请生成诊断包检查");
function unwrap<T>(response:any):T{if(response?.code!==200)throw new Error(response?.message||"请求失败");return response.data as T;}
async function refresh(){loading.value=true;try{status.value=unwrap(await axios.get("/xiaoyu/compute-center/maintenance/status"));}catch(error:any){MessagePlugin.error(error?.message||"维护状态读取失败");}finally{loading.value=false;}}
async function showFile(file:string){try{await axios.post("/xiaoyu/compute-center/maintenance/show-file",{file});}catch{}}
async function downloadMaintenanceFile(file:string){const data=await axios.get("/xiaoyu/compute-center/maintenance/download",{params:{file},responseType:"blob"});const blob=data instanceof Blob?data:new Blob([data]);const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=file.split(/[\\/]/).pop()||"xiaoyu-maintenance.zip";document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);}
async function createBackup(){loading.value=true;try{const data=unwrap<any>(await axios.post("/xiaoyu/compute-center/maintenance/backup"));lastBackup.value=data.file;MessagePlugin.success("备份完成");if(isElectron.value)await showFile(data.file);else await downloadMaintenanceFile(data.file);await refresh();}catch(error:any){MessagePlugin.error(error?.message||"备份失败");}finally{loading.value=false;}}
async function createDiagnostics(){loading.value=true;try{const data=unwrap<any>(await axios.post("/xiaoyu/compute-center/maintenance/diagnostics"));lastDiagnostic.value=data.file;MessagePlugin.success("诊断包已生成");if(isElectron.value)await showFile(data.file);else await downloadMaintenanceFile(data.file);}catch(error:any){MessagePlugin.error(error?.message||"诊断包生成失败");}finally{loading.value=false;}}
async function restoreBackup(){try{const chosen=unwrap<any>(await axios.post("/xiaoyu/compute-center/maintenance/restore/select"));if(chosen.cancelled||!chosen.file)return;const dialog=DialogPlugin.confirm({header:"确认恢复备份",body:"系统会先自动备份当前数据，再准备恢复。恢复将在重启应用后执行。",confirmBtn:"准备恢复",onConfirm:async()=>{dialog.destroy();loading.value=true;try{await axios.post("/xiaoyu/compute-center/maintenance/restore/prepare",{file:chosen.file});MessagePlugin.success("恢复已准备，请重启小鱼Ai短剧生成系统");}catch(error:any){MessagePlugin.error(error?.message||"恢复准备失败");}finally{loading.value=false;}},onCancel:()=>dialog.destroy()});}catch(error:any){MessagePlugin.error(error?.message||"选择备份失败");}}
async function checkUpdate(){loading.value=true;try{updateState.value=unwrap(await axios.get("/xiaoyu/compute-center/maintenance/update/check"));updateChecked.value=true;downloadedFile.value="";MessagePlugin.success(updateState.value.available?`发现新版本 ${updateState.value.manifest.version}`:"当前已是最新版本");}catch(error:any){MessagePlugin.error(error?.message||"更新检查失败");}finally{loading.value=false;}}
async function downloadUpdate(){if(!updateState.value.manifest)return;downloading.value=true;try{const data=unwrap<any>(await axios.post("/xiaoyu/compute-center/maintenance/update/download",{manifest:updateState.value.manifest}));downloadedFile.value=data.file;MessagePlugin.success("更新包下载和签名校验通过");}catch(error:any){MessagePlugin.error(error?.message||"更新下载失败");}finally{downloading.value=false;}}
async function installUpdate(){if(!downloadedFile.value||!updateState.value.manifest)return;const dialog=DialogPlugin.confirm({header:"安装已验证更新",body:"安装前会自动创建完整备份。启动安装程序后当前应用将退出。",confirmBtn:"备份并安装",onConfirm:async()=>{dialog.destroy();try{await axios.post("/xiaoyu/compute-center/maintenance/update/install",{manifest:updateState.value.manifest,file:downloadedFile.value});}catch(error:any){MessagePlugin.error(error?.message||"更新安装失败");}},onCancel:()=>dialog.destroy()});}
onMounted(refresh);
</script>
<style scoped lang="scss">.maintenance-page{padding-bottom:28px}.headline{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:18px}.headline h3{margin:0 0 6px;font-size:20px}.headline p,.grid p{color:var(--td-text-color-secondary);line-height:1.6}.support{white-space:nowrap;padding:8px 12px;border-radius:10px;background:var(--td-bg-color-secondarycontainer)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.result,.notes{margin-top:12px;padding:10px;border-radius:8px;background:var(--td-bg-color-secondarycontainer);word-break:break-all}.update-state{display:flex;align-items:center;gap:10px;flex-wrap:wrap}@media(max-width:900px){.grid{grid-template-columns:1fr}.headline{flex-direction:column}}</style>
