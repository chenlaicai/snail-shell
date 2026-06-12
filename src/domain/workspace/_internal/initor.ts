import type { FileDataStore } from "@infra/file-data-store";
import { FileWorkspaceRepository } from "./repository";
import { WorkspaceAdapter } from "./adapter";

/** 初始化 Workspace 模块 */
export function init(dataStore: FileDataStore) {
  const repo = new FileWorkspaceRepository(dataStore);
  const adapter = new WorkspaceAdapter(repo);
  return { repo, adapter };
}
