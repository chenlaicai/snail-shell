import type { FileDataStore } from "@infra/file-data-store";
import { FileGuardProfileRepository } from "@domain/guard-profile/_internal/repository";
import { GuardProfileAdapter } from "@domain/guard-profile/_internal/adapter";

/** 初始化 Guard Profile 模块 */
export function init(dataStore: FileDataStore) {
  const repo = new FileGuardProfileRepository(dataStore);
  const adapter = new GuardProfileAdapter(repo);
  return { repo, adapter };
}
