import { ConfigStore } from "@infra/config-store";

export const DEFAULT_SERVER_PORT = 3000;
export const DEFAULT_MAX_CONCURRENT_AGENTS = 3;

export interface ServerConfig {
  port?: number;
  max_concurrent_agents?: number;
}

export interface ServerSettings {
  port: number;
  httpBaseUrl: string;
  wsBaseUrl: string;
  maxConcurrentAgents: number;
}

export function loadServerSettings(repoRoot: string): ServerSettings {
  return resolveServerSettings(new ConfigStore(repoRoot).readYaml<ServerConfig>("server.yaml"));
}

export function resolveServerSettings(config: ServerConfig | null): ServerSettings {
  const port = config?.port ?? DEFAULT_SERVER_PORT;
  const httpBaseUrl = `http://localhost:${port}`;
  const wsBaseUrl = `ws://localhost:${port}`;
  const maxConcurrentAgents = config?.max_concurrent_agents ?? DEFAULT_MAX_CONCURRENT_AGENTS;
  return { port, httpBaseUrl, wsBaseUrl, maxConcurrentAgents };
}
