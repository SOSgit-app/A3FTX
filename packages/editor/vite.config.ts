import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    alias: {
      "@a3-ftx/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  publicDir: "public",
});
