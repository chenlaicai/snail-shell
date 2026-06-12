import type { Workspace } from "@domain/workspace/model";
import type { SnailMCPServerPort } from "@domain/snail-mcp-server/port";
import type { FileDataStore } from "@infra/file-data-store";
import type { ConfigStore } from "@infra/config-store";
import { FileMCPRepository } from "./repository";
import { MCPAdapter } from "./adapter";

/** MCP 模块依赖 */
export interface MCPDeps {
  dataStore: FileDataStore;
  workspaces: Workspace[];
  snailMCPServer: SnailMCPServerPort;
  configStore: ConfigStore;
}

/** 初始化 MCP 模块 */
export function init(deps: MCPDeps) {
  // 从 config/server.yaml 读取端口，构造 MCP endpoint base URL
  const serverConfig = deps.configStore.readYaml<{ port?: number }>("server.yaml");
  const port = serverConfig?.port ?? 3000;
  const baseUrl = `http://localhost:${port}`;

  const repo = new FileMCPRepository(deps.dataStore, deps.workspaces, deps.snailMCPServer, baseUrl);
  const adapter = new MCPAdapter(repo);
  return { repo, adapter };
}
