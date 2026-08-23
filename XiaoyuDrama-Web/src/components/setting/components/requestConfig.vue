<template>
  <div class="requestConfig">
    <t-alert style="margin-bottom: 16px" theme="warning" :message="$t('settings.request.warning')"></t-alert>
    <t-form :data="formData" labelAlign="top" :rules="formRules">
      <t-form-item :label="$t('settings.request.apiAddress')" name="baseUrl">
        <t-input v-model="formData.baseUrl" :placeholder="$t('settings.request.apiPlaceholder')" clearable>
          <template #prefix-icon><t-icon name="link" /></template>
        </t-input>
      </t-form-item>
      <t-form-item>
        <t-space size="small">
          <t-button theme="primary" type="submit" @click="handleSubmit">{{ $t("settings.request.save") }}</t-button>
          <t-button theme="default" @click="handleReset">{{ $t("settings.request.reset") }}</t-button>
          <t-button v-if="isElectron" theme="warning" @click="refreshAPI">{{ $t("settings.request.refresh") }}</t-button>
        </t-space>
      </t-form-item>
    </t-form>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { type FormRules } from "tdesign-vue-next";
import settingStore from "@/stores/setting";
import { defaultBackendApiUrl, normalizeBackendApiUrl } from "@/utils/backendUrl";
const { baseUrl, isElectron } = storeToRefs(settingStore());
interface RequestForm { baseUrl: string; }
const formData = ref<RequestForm>({ baseUrl: "" });
const formRules: FormRules<RequestForm> = {
  baseUrl: [
    { required: true, message: $t("settings.request.msg.enterApi"), trigger: "blur" },
    { pattern: /^https?:\/\/.+/, message: $t("settings.request.msg.validUrl"), trigger: "blur" },
  ],
};
function loadSettings() { formData.value.baseUrl = baseUrl.value; }
function handleSubmit() {
  baseUrl.value = normalizeBackendApiUrl(formData.value.baseUrl);
  formData.value.baseUrl = baseUrl.value;
  window.$message.success($t("settings.request.msg.saved"));
}
function handleReset() {
  formData.value.baseUrl = defaultBackendApiUrl();
  baseUrl.value = normalizeBackendApiUrl(formData.value.baseUrl);
  window.$message.success($t("settings.request.msg.reset"));
}
async function refreshAPI() {
  try {
    const res = await fetch("xiaoyu-drama://getAppUrl");
    const data = await res.json();
    if (data?.port) {
      baseUrl.value = normalizeBackendApiUrl(data.url);
      formData.value.baseUrl = baseUrl.value;
      isElectron.value = true;
      window.$message.success($t("settings.request.msg.refreshSuccess"));
    }
  } catch {
    window.$message.error($t("settings.request.msg.refreshFailed"));
  }
}
onMounted(loadSettings);
</script>
<style lang="scss" scoped></style>
