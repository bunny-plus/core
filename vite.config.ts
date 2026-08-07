import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const buildVersion =
  process.env.GITHUB_SHA?.slice(0, 7) ??
  new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);

export default defineConfig({
  build: { outDir: "dist/client" },
  define: { __STATIC_VERSION__: JSON.stringify(buildVersion) },
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true },
      "/auth": { target: "http://localhost:8787" },
    },
  },
});
