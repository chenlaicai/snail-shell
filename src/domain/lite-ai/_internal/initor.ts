import type { FileDataStore } from "@infra/file-data-store";
import { FileLiteAIRepository } from "@domain/lite-ai/_internal/repository";
import { LiteAIAdapter } from "@domain/lite-ai/_internal/adapter";

/** 初始化 Lite AI 模块 */
export function init(dataStore: FileDataStore) {
  const repo = new FileLiteAIRepository(dataStore);
  const adapter = new LiteAIAdapter(repo);
  return { repo, adapter };
}
