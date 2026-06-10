import type { FileSystem } from "@infra/file-system";
import { FileWorkspaceRepository } from "./repository";
import { WorkspaceAdapter } from "./adapter";

/** 初始化 Workspace 模块 */
export function init(fs: FileSystem, repoRoot: string) {
  const repo = new FileWorkspaceRepository(fs, repoRoot);
  const adapter = new WorkspaceAdapter(repo);
  return { repo, adapter };
}
