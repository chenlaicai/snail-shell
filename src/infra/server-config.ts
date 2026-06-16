import { ConfigStore } from "@infra/config-store";

export const DEFAULT_SERVER_PORT = 3000;

export interface ServerConfig {
  port?: number;
}

export interface ServerSettings {
  port: number;
  httpBaseUrl: string;
  wsBaseUrl: string;
}

export function loadServerSettings(repoRoot: string): ServerSettings {
  return resolveServerSettings(new ConfigStore(repoRoot).readYaml<ServerConfig>("server.yaml"));
}

export function resolveServerSettings(config: ServerConfig | null): ServerSettings {
  const port = config?.port ?? DEFAULT_SERVER_PORT;
  const httpBaseUrl = `http://localhost:${port}`;
  const wsBaseUrl = `ws://localhost:${port}`;
  return { port, httpBaseUrl, wsBaseUrl };
}
