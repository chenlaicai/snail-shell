import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@domain": path.resolve(__dirname, "src/domain"),
      "@infra": path.resolve(__dirname, "src/infra"),
      "@adapter": path.resolve(__dirname, "src/adapter"),
      "@app": path.resolve(__dirname, "src/app"),
      "@api-contracts": path.resolve(__dirname, "src/api-contracts"),
    },
  },
});
