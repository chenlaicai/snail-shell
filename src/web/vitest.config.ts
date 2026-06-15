import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "@api-contracts": path.resolve(__dirname, "../api-contracts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "tests/setup.ts")],
    include: [path.resolve(__dirname, "tests/**/*.test.{ts,tsx}")],
  },
});
