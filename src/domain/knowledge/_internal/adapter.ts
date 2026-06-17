import type { Workspace } from "@domain/workspace/model";
import type { KnowledgeEntry, CreateKnowledgeInput, RemoveKnowledgeInput } from "@domain/knowledge/model";
import type { KnowledgePort, SearchResult } from "@domain/knowledge/port";
import type { KnowledgeRepository } from "@domain/knowledge/_internal/repository";
import type { KnowledgeSearchIndex } from "@domain/knowledge/_internal/search-index";

/**
 * Knowledge 适配器实现。
 *
 * 双写策略：
 * - 文件是真相源（repository）
 * - FTS5 是搜索索引（search-index）
 * - 写入时双写，搜索时走索引
 */
export class KnowledgeAdapter implements KnowledgePort {
  constructor(
    private repo: KnowledgeRepository,
    private index: KnowledgeSearchIndex,
  ) {}

  list(): KnowledgeEntry[] {
    return this.repo.list();
  }

  findByWorkspace(workspace: Workspace): KnowledgeEntry[] {
    return this.repo.findByWorkspace(workspace);
  }

  add(input: CreateKnowledgeInput): KnowledgeEntry {
    const entry = this.repo.add(input);
    this.index.upsert(entry);
    return entry;
  }

  remove(input: RemoveKnowledgeInput): void {
    this.repo.remove(input);
    this.index.remove(input.id);
  }

  search(query: string, workspace?: Workspace): SearchResult[] {
    return this.index.search(query, workspace?.path);
  }
}
