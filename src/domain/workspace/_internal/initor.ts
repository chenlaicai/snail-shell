import type { FileDataStore } from "@infra/file-data-store";
import { FileWorkspaceRepository } from "@domain/workspace/_internal/repository";
import { WorkspaceAdapter } from "@domain/workspace/_internal/adapter";

/** 初始化 Workspace 模块 */
export function init(dataStore: FileDataStore) {
  const repo = new FileWorkspaceRepository(dataStore);
  const adapter = new WorkspaceAdapter(repo);
  return { repo, adapter };
}
