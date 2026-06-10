import type {
  KnowledgeEntry,
  KnowledgeSearchResult,
  CreateKnowledgeInput,
  KnowledgeListFilters,
  KnowledgeSummary,
} from "@domain/knowledge/model";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { KnowledgeRepository } from "./repository";

/**
 * Knowledge 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class KnowledgeAdapter implements KnowledgePort {
  constructor(private repo: KnowledgeRepository) {}

  summary(workspaceId?: string): KnowledgeSummary {
    return this.repo.summary(workspaceId);
  }

  list(filters?: KnowledgeListFilters): KnowledgeEntry[] {
    return this.repo.list(filters);
  }

  findById(id: string): KnowledgeEntry | undefined {
    return this.repo.findById(id);
  }

  search(query: string, filters?: KnowledgeListFilters): KnowledgeSearchResult[] {
    return this.repo.search(query, filters);
  }

  create(input: CreateKnowledgeInput): KnowledgeEntry {
    return this.repo.create(input);
  }
}
