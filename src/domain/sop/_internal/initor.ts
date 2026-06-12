import type { Workspace } from "@domain/workspace/model";
import type { FileDataStore } from "@infra/file-data-store";
import { FileSopRepository } from "./repository";
import { SopAdapter } from "./adapter";

/** 初始化 SOP 模块 */
export function init(dataStore: FileDataStore, workspaces: Workspace[]) {
  const repo = new FileSopRepository(dataStore, workspaces);
  const adapter = new SopAdapter(repo);
  return { repo, adapter };
}
