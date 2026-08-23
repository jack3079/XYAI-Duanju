import { defaultBackendApiUrl, normalizeBackendApiUrl } from "@/utils/backendUrl";
export default defineStore(
  "setting",
  () => {
    const showSetting = ref(false);
    const isElectron = ref(false);
    const canvasWheelEvent = ref("zoom");
    const activeMenu = ref("ui");

    const baseUrl = ref<string>(defaultBackendApiUrl());

    // 兼容旧版本曾保存的 http://localhost:10588（缺少 /api）。
    // Pinia 持久化恢复后 watch 也会再次规范，用户无需手动清 localStorage。
    watch(
      baseUrl,
      (value) => {
        const normalized = normalizeBackendApiUrl(value);
        if (normalized !== value) baseUrl.value = normalized;
      },
      { immediate: true },
    );

    const needUpdate = ref(false);

    const otherSetting = ref({
      axiosTimeOut: 60 * 10 * 1000,
      assetsBatchGenereateSize: 5,
      chapterReg: "/第\\s*([0-9０-９零一二三四五六七八九十百千万]+)\\s*[章回节]\\s*([^\\n\\r]*)/g",
      interacting: true,
      scriptEpisodeLength: 5000,
    });

    const themeSetting = ref<{
      mode: "auto" | "light" | "dark";
      primaryColor: string;
      fontSize: number;
    }>({
      mode: "auto",
      primaryColor: "#0052D9",
      fontSize: 16,
    });

    const systemDark = ref(false);
    if (typeof window !== "undefined") {
      const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
      systemDark.value = colorScheme.matches;
      colorScheme.addEventListener("change", (event) => {
        systemDark.value = event.matches;
      });
    }
    const editorTheme = computed<"light" | "dark">(() => {
      if (themeSetting.value.mode === "auto") return systemDark.value ? "dark" : "light";
      return themeSetting.value.mode;
    });

    const language = ref<string>("zh-CN");

    return { showSetting, baseUrl, otherSetting, themeSetting, editorTheme, language, activeMenu, isElectron, canvasWheelEvent, needUpdate };
  },
  { persist: { pick: ["baseUrl", "otherSetting", "themeSetting", "language"] } },
);
