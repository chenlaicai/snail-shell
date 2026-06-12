import type { FileDataStore } from "@infra/file-data-store";
import type { Workspace } from "@domain/workspace/model";
import { FileTenetPromptRepository } from "./repository";
import { TenetPromptAdapter } from "./adapter";

/** 初始化 TenetPrompt 模块 */
export function init(fileDataStore: FileDataStore, workspaces: Workspace[]) {
  const repo = new FileTenetPromptRepository(fileDataStore, workspaces);
  const adapter = new TenetPromptAdapter(repo);
  return { repo, adapter };
}
