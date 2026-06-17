import path from "path";
import type { Workspace } from "@domain/workspace/model";
import type { FileDataStore } from "@infra/file-data-store";
import { FileKnowledgeRepository } from "@domain/knowledge/_internal/repository";
import { KnowledgeSearchIndex } from "@domain/knowledge/_internal/search-index";
import { KnowledgeAdapter } from "@domain/knowledge/_internal/adapter";

/**
 * 初始化 Knowledge 模块。
 *
 * @param dataStore 文件数据存储
 * @param workspaces 工作区列表
 * @param repoRoot 仓库根目录，用于定位索引文件（data/knowledge-search.db）
 */
export function init(dataStore: FileDataStore, workspaces: Workspace[], repoRoot: string) {
  const repo = new FileKnowledgeRepository(dataStore, workspaces);

  const indexPath = path.join(repoRoot, "data", "knowledge-search.db");
  const index = new KnowledgeSearchIndex(indexPath);

  // 启动时校验索引完整性
  const fileEntries = repo.list();
  const missingIds = index.validate(fileEntries.map((e) => e.id));
  if (missingIds.length > 0) {
    console.log(`[knowledge] Rebuilding search index (${missingIds.length} entries missing)`);
    index.rebuild(fileEntries);
  }

  const adapter = new KnowledgeAdapter(repo, index);
  return { repo, index, adapter };
}
