import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { TDesignResolver } from "@tdesign-vue-next/auto-import-resolver";
import { viteSingleFile } from "vite-plugin-singlefile";
import postcsspxtoviewport from "postcss-px-to-viewport";

const proxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || "http://127.0.0.1:10588";

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: Infinity,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  plugins: [
    vue(),
    AutoImport({
      dts: "src/types/auto-imports.d.ts",
      imports: ["vue", "pinia", "vue-router"],
      resolvers: [
        TDesignResolver({ library: "vue-next" }),
        TDesignResolver({ library: "chat" }),
      ],
    }),
    Components({
      dts: "src/types/components.d.ts",
      resolvers: [
        TDesignResolver({ library: "vue-next" }),
        TDesignResolver({ library: "chat" }),
      ],
    }),
    viteSingleFile(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  css: {
    preprocessorOptions: { scss: { api: "modern-compiler" } },
    postcss: {
      plugins: [
        postcsspxtoviewport({
          unitToConvert: "px",
          viewportWidth: 1600,
          unitPrecision: 4,
          viewportUnit: "rem",
          fontViewportUnit: "rem",
          propList: ["*"],
          selectorBlackList: ["ignore"],
          minPixelValue: 1,
          mediaQuery: true,
          replace: true,
          exclude: [],
          include: [],
          landscape: false,
        }),
      ],
    },
  },
  server: {
    host: "0.0.0.0",
    port: 50188,
    proxy: {
      "/api": { target: proxyTarget, changeOrigin: true },
      "/oss": { target: proxyTarget, changeOrigin: true },
      "/skills": { target: proxyTarget, changeOrigin: true },
      "/assets": { target: proxyTarget, changeOrigin: true },
      "/socket.io": { target: proxyTarget, changeOrigin: true, ws: true },
    },
  },
});
