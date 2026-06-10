import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const FASTIFY_PORT = Number(process.env.FASTIFY_PORT ?? 3000);
const FASTIFY_HOST = process.env.FASTIFY_HOST ?? "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: `http://${FASTIFY_HOST}:${FASTIFY_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
