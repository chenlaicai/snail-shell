import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@domain": path.resolve(__dirname, "src/domain"),
      "@infra": path.resolve(__dirname, "src/infra"),
      "@app": path.resolve(__dirname, "src/app"),
      "@api-contracts": path.resolve(__dirname, "src/api-contracts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
