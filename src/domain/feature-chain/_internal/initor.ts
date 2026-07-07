import type { SQLiteDatabase } from "@infra/database";
import { FileLoader } from "@infra/file-loader";
import { FileFeatureChainRepository } from "@domain/feature-chain/_internal/repository";
import { FeatureChainAdapter } from "@domain/feature-chain/_internal/adapter";
import { FeatureDocSearchIndex } from "@domain/feature-chain/_internal/search-index";

/** 初始化 Feature Chain 模块 */
export function init(repoRoot: string, db: SQLiteDatabase) {
  const loader = new FileLoader(repoRoot);
  const repo = new FileFeatureChainRepository(loader);
  const searchIndex = new FeatureDocSearchIndex(db);

  // 启动时重建文件索引和 FTS5 搜索索引
  repo.rebuild();
  searchIndex.rebuild(repo.listAll());

  const adapter = new FeatureChainAdapter(repo, searchIndex);
  return { repo, searchIndex, adapter };
}
