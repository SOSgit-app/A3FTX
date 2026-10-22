import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/A3FTX/" : "/",
  server: {
    port: 5174,
    fs: { allow: [path.resolve(__dirname, "../..")] },
  },
  resolve: {
    alias: {
      "@a3-ftx/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
