import type { Workspace } from "@domain/workspace/model";
import type { FileDataStore } from "@infra/file-data-store";
import { FileKnowledgeRepository } from "./repository";
import { KnowledgeAdapter } from "./adapter";

/** 初始化 Knowledge 模块 */
export function init(dataStore: FileDataStore, workspaces: Workspace[]) {
  const repo = new FileKnowledgeRepository(dataStore, workspaces);
  const adapter = new KnowledgeAdapter(repo);
  return { repo, adapter };
}
