import { defineConfig } from "vitest/config";
import path from "path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/web/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: false,
    passWithNoTests: true,
    setupFiles: ["src/web/test-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web"),
    },
  },
});
