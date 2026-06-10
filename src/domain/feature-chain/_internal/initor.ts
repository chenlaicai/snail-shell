import type { FileSystem } from "@infra/file-system";
import { FileFeatureChainRepository } from "./repository";
import { FeatureChainAdapter } from "./adapter";

/** 初始化 Feature Chain 模块 */
export function init(fs: FileSystem, repoRoot: string) {
  const repo = new FileFeatureChainRepository(fs, repoRoot);
  const adapter = new FeatureChainAdapter(repo);
  return { repo, adapter };
}
