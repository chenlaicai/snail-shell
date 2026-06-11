import type { FileDataStore } from "@infra/file-data-store";
import { FileGuardProfileRepository } from "./repository";
import { GuardProfileAdapter } from "./adapter";

/** 初始化 Guard Profile 模块 */
export function init(dataStore: FileDataStore) {
  const repo = new FileGuardProfileRepository(dataStore);
  const adapter = new GuardProfileAdapter(repo);
  return { repo, adapter };
}
