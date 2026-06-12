import type { FileDataStore } from "@infra/file-data-store";
import { FileLiteAIRepository } from "./repository";
import { LiteAIAdapter } from "./adapter";

/** 初始化 Lite AI 模块 */
export function init(dataStore: FileDataStore) {
  const repo = new FileLiteAIRepository(dataStore);
  const adapter = new LiteAIAdapter(repo);
  return { repo, adapter };
}
