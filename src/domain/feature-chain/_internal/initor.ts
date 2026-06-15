import { FileLoader } from "@infra/file-loader";
import { FileFeatureChainRepository } from "@domain/feature-chain/_internal/repository";
import { FeatureChainAdapter } from "@domain/feature-chain/_internal/adapter";

/** 初始化 Feature Chain 模块 */
export function init(repoRoot: string) {
  const loader = new FileLoader(repoRoot);
  const repo = new FileFeatureChainRepository(loader);
  const adapter = new FeatureChainAdapter(repo);
  return { repo, adapter };
}
