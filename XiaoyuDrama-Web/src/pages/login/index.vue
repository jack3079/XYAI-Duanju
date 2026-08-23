<template>
  <div class="loginPage" :style="{ height: isElectron ? 'calc(100vh - 32px)' : '100vh' }">
    <div class="formBox">
      <t-dialog v-model:visible="showSettingModal" :header="$t('login.settings')" @confirm="handleSaveSetting" :width="400">
        <t-form label-width="80px" labelAlign="top">
          <t-form-item :label="$t('login.requestAddress')"><t-input v-model="tempBaseUrl" placeholder="http://localhost:10588/api" /></t-form-item>
        </t-form>
      </t-dialog>
      <div class="logoBox fc"><div class="logoImg"></div><div class="fc c"><span class="logoText">小鱼Ai短剧生成系统</span><span class="slogan">{{ $t("login.slogan") }}</span></div></div>
      <div class="login-form">
        <t-input v-model="state.user.username" :placeholder="$t('login.username')" autocomplete="username" size="large"></t-input>
        <t-input v-model="state.user.password" type="password" :placeholder="$t('login.password')" size="large"></t-input>
        <t-button class="loginBtn" theme="primary" size="large" :loading="state.loginLoading" @click="handleLogin" block>{{ $t("login.login") }}</t-button>
      </div>
      <div class="tips c">{{ $t("login.tips") }}</div>
    </div>
  </div>
  <div class="settingBtn">
    <t-dropdown :options="langOptions" trigger="click" @click="handleChangeLang" :maxColumnWidth="150"><t-button shape="circle" theme="default" size="large"><template #icon><i-translate theme="outline" size="20" /></template></t-button></t-dropdown>
    <t-button shape="circle" theme="primary" size="large" @click="showSettingModal = true"><template #icon><i-setting-two theme="outline" size="20" /></template></t-button>
  </div>
</template>
<script setup>
import { useI18n } from "vue-i18n";
import Router from "@/router/index.ts";
import axios from "@/utils/axios";
import settingStore from "@/stores/setting";
import { storeToRefs } from "pinia";
import { languageList, cachedLocale } from "@/locales";
import { normalizeBackendApiUrl } from "@/utils/backendUrl";
const { locale } = useI18n();
const langOptions = languageList.map((item) => ({ content: item.label, value: item.value }));
const handleChangeLang = (data) => { locale.value = data.value; cachedLocale.value = data.value; };
const store = settingStore();
const { baseUrl, isElectron } = storeToRefs(store);
const showSettingModal = ref(false);
const tempBaseUrl = ref(baseUrl.value);
const handleSaveSetting = () => { baseUrl.value = normalizeBackendApiUrl(tempBaseUrl.value); tempBaseUrl.value = baseUrl.value; showSettingModal.value = false; window.$message.success($t("login.settingsSaved")); };
const state = ref({ show: true, loginLoading: false, user: { username: "", password: "" } });
const handleLogin = () => {
  if (!state.value.user.username || !state.value.user.password) { window.$message.warning($t("login.enterUsernameAndPassword")); return; }
  state.value.loginLoading = true;
  axios.post("/login/login", { ...state.value.user }).then(({ data }) => {
    localStorage.setItem("token", data.token); localStorage.setItem("userId", data.id); Router.push("/project"); window.$message.success($t("login.loginSuccess"));
  }).catch((e) => window.$message.error(e?.message || $t("login.loginFailed"))).finally(() => { state.value.loginLoading = false; });
};
</script>
<style lang="scss" scoped>
.loginPage{height:100vh;display:flex;justify-content:center;align-items:center}.formBox{width:380px;padding:40px 40px 30px;background:var(--td-bg-color-container);border-radius:20px;box-shadow:var(--td-shadow-3)}.logoBox{display:flex;justify-content:center;align-items:center;margin-bottom:30px;gap:12px}.logoImg{width:64px;height:64px;background-color:var(--td-text-color-primary);mask:url("@/assets/logo.svg") no-repeat center;mask-size:contain;-webkit-mask:url("@/assets/logo.svg") no-repeat center;-webkit-mask-size:contain}.logoText{font-size:36px;font-weight:800;color:var(--td-text-color-primary);letter-spacing:1px}.slogan{opacity:.5;white-space:nowrap}.login-form{display:flex;flex-direction:column;gap:20px}.tips{opacity:.5;font-size:12px;margin-top:18px}.settingBtn{position:fixed;right:24px;bottom:24px;z-index:9999;display:flex;flex-direction:column;gap:12px}
</style>
