import type { Workspace } from "@domain/workspace/model";
import type { FileDataStore } from "@infra/file-data-store";
import type { SQLiteDatabase } from "@infra/database";
import { FileKnowledgeRepository } from "@domain/knowledge/_internal/repository";
import { KnowledgeSearchIndex } from "@domain/knowledge/_internal/search-index";
import { KnowledgeAdapter } from "@domain/knowledge/_internal/adapter";

/**
 * 初始化 Knowledge 模块。
 *
 * @param dataStore 文件数据存储
 * @param workspaces 工作区列表
 * @param db 平台级数据库实例
 */
export function init(dataStore: FileDataStore, workspaces: Workspace[], db: SQLiteDatabase) {
  const repo = new FileKnowledgeRepository(dataStore, workspaces);

  const index = new KnowledgeSearchIndex(db);

  // 启动时校验索引完整性（检测缺失、过时、残留）
  const fileEntries = repo.list();
  if (index.validate(fileEntries)) {
    console.log(`[knowledge] Rebuilding search index (${fileEntries.length} entries)`);
    index.rebuild(fileEntries);
  }

  const adapter = new KnowledgeAdapter(repo, index);
  return { repo, index, adapter };
}
