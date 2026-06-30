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
