import type { Workspace } from "@domain/workspace/model";
import type { MCPServerPort } from "@domain/snail-mcp-server/port";
import type { FileDataStore } from "@infra/file-data-store";
import { FileMCPRepository } from "./repository";
import { MCPAdapter } from "./adapter";

/** MCP 模块依赖 */
export interface MCPDeps {
  dataStore: FileDataStore;
  workspaces: Workspace[];
  snailMCPServer: MCPServerPort;
}

/** 初始化 MCP 模块 */
export function init(deps: MCPDeps) {
  const repo = new FileMCPRepository(deps.dataStore, deps.workspaces, deps.snailMCPServer);
  const adapter = new MCPAdapter(repo);
  return { repo, adapter };
}
