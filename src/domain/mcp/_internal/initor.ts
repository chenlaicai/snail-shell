import type { Workspace } from "@domain/workspace/model";
import type { FileDataStore } from "@infra/file-data-store";
import { FileMCPRepository } from "./repository";
import { MCPAdapter } from "./adapter";

/** 初始化 MCP 模块 */
export function init(dataStore: FileDataStore, workspaces: Workspace[]) {
  const repo = new FileMCPRepository(dataStore, workspaces);
  const adapter = new MCPAdapter(repo);
  return { repo, adapter };
}
