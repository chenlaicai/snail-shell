import { FileLoader } from "@infra/file-loader";
import { FileFeatureChainRepository } from "./repository";
import { FeatureChainAdapter } from "./adapter";

/** 初始化 Feature Chain 模块 */
export function init(repoRoot: string) {
  const loader = new FileLoader(repoRoot);
  const repo = new FileFeatureChainRepository(loader);
  const adapter = new FeatureChainAdapter(repo);
  return { repo, adapter };
}
