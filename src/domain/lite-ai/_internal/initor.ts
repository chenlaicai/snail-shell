import type { FileSystem } from "@infra/file-system";
import { FileLiteAIRepository } from "./repository";
import { LiteAIAdapter } from "./adapter";

/** 初始化 Lite AI 模块 */
export function init(fs: FileSystem, repoRoot: string) {
  const repo = new FileLiteAIRepository(fs, repoRoot);
  const adapter = new LiteAIAdapter(repo);
  return { repo, adapter };
}
