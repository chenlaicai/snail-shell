import type { Workspace } from "@domain/workspace/model";
import type { SnailMCPServerPort } from "@domain/snail-mcp-server/port";
import type { FileDataStore } from "@infra/file-data-store";
import type { ServerSettings } from "@infra/server-config";
import { FileMCPRepository } from "@domain/mcp/_internal/repository";
import { MCPAdapter } from "@domain/mcp/_internal/adapter";

/** MCP 模块依赖 */
export interface MCPDeps {
  dataStore: FileDataStore;
  workspaces: Workspace[];
  snailMCPServer: SnailMCPServerPort;
  serverSettings: ServerSettings;
}

/** 初始化 MCP 模块 */
export function init(deps: MCPDeps) {
  const repo = new FileMCPRepository(deps.dataStore, deps.workspaces, deps.snailMCPServer, deps.serverSettings.httpBaseUrl);
  const adapter = new MCPAdapter(repo);
  return { repo, adapter };
}
