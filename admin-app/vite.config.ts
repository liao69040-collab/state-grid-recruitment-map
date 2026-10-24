import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: env.VITE_DEV_API_PROXY
        ? {
            "/api/v2": {
              target: env.VITE_DEV_API_PROXY,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    build: {
      target: "es2022",
      sourcemap: false,
      assetsDir: "assets",
    },
  };
});
