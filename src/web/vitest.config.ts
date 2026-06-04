import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "tests/setup.ts")],
    include: [path.resolve(__dirname, "tests/**/*.test.{ts,tsx}")],
  },
});
