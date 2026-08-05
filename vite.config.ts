import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/client" },
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true },
      "/auth": { target: "http://localhost:8787" },
    },
  },
});
