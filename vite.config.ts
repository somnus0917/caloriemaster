import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

const localRequire = createRequire(import.meta.url);
const { readEnv, createApiRouter } = localRequire("./server/api.cjs");

function apiProxyPlugin(): Plugin {
  return {
    name: "caloriemaster-api-proxy",
    configureServer(server) {
      const env = readEnv();
      const api = createApiRouter(env);
      const hasQwen = Boolean(env.QWEN_API_KEY);
      const hasBoohee = Boolean(env.BOOHEE_API_KEY);
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || "/";
        const qIndex = raw.indexOf("?");
        const pathname = qIndex === -1 ? raw : raw.slice(0, qIndex);
        if (
          pathname === "/api/recognize-food" ||
          pathname === "/api/boohee" ||
          pathname.startsWith("/api/")
        ) {
          await api(req, res);
          return;
        }
        next();
      });
      console.log(
        `\n[caloriemaster] API proxy ready. Qwen ${hasQwen ? "loaded" : "MISSING"}, Boohee ${hasBoohee ? "loaded" : "MISSING"} (from .env)\n` +
          (hasQwen
            ? ""
            : "  → Add QWEN_API_KEY to .env to enable AI recognition.\n"),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
