import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Clean DB state per test file (especially with :memory: DBs)
    isolate: true,
    reporters: ["default"],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // CSS/PostCSS is handled by the conditional in postcss.config.mjs when VITEST=1 / NODE_ENV=test.
});