import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_WEB_PORT = 5173;

interface ServerYamlConfig {
  port?: number;
  web_port?: number;
}

interface WebDevSettings {
  backendPort: number;
  webPort: number;
}

function readWebDevSettings(repoRoot: string): WebDevSettings {
  const configPath = path.join(repoRoot, "config", "server.yaml");
  if (!fs.existsSync(configPath)) return { backendPort: DEFAULT_BACKEND_PORT, webPort: DEFAULT_WEB_PORT };

  const raw = fs.readFileSync(configPath, "utf8");
  const config = parseYaml(raw) as ServerYamlConfig | null;
  return {
    backendPort: config?.port ?? DEFAULT_BACKEND_PORT,
    webPort: config?.web_port ?? DEFAULT_WEB_PORT,
  };
}

export default defineConfig(() => {
  const webDevSettings = readWebDevSettings(process.cwd());
  const backendHttpBaseUrl = `http://localhost:${webDevSettings.backendPort}`;

  return {
    plugins: [react()],
    root: path.resolve(__dirname),
    build: {
      outDir: path.resolve(__dirname, "../../dist/web"),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname),
        "@api-contracts": path.resolve(__dirname, "../api-contracts"),
      },
    },
    server: {
      port: webDevSettings.webPort,
      strictPort: true,
      watch: {
        cwd: path.resolve(__dirname),
        /**
         * 忽略 worktree 目录中的文件变更。worktree 是 Snail Shell 多 Agent 协作的独立工作副本，
         * 其文件变更不应触发 Vite dev server 的 HMR 或 full-reload。
         * 特别是 tsconfig.json 变更会触发 cache 清除和 full-reload，导致 close issue 时
         * (git worktree remove 删除 worktree 目录) 页面发生完整刷新。
         */
        ignored: [
          "**/.snail/worktrees/**",
          "**/.claude/worktrees/**",
        ],
      },
      proxy: {
        "/api": backendHttpBaseUrl,
        "/mcp-server": backendHttpBaseUrl,
        "/issue-events": {
          target: backendHttpBaseUrl,
          ws: true,
        },
        "/workspace-events": {
          target: backendHttpBaseUrl,
          ws: true,
        },
      },
    },
  };
});
