import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const buildVersion =
  process.env.GITHUB_SHA?.slice(0, 7) ??
  new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);

const versionSource = `${JSON.stringify({ version: buildVersion })}\n`;

export default defineConfig({
  build: { outDir: "dist/client" },
  define: { __STATIC_VERSION__: JSON.stringify(buildVersion) },
  plugins: [
    react(),
    {
      name: "bunny-version",
      configureServer(server) {
        server.middlewares.use("/version.json", (_request, response) => {
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "application/json");
          response.end(versionSource);
        });
      },
      generateBundle() {
        this.emitFile({ fileName: "version.json", source: versionSource, type: "asset" });
      },
    },
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true },
      "/auth": { target: "http://localhost:8787" },
    },
  },
});
