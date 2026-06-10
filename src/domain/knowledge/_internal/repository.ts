import type {
  KnowledgeEntry,
  KnowledgeSearchResult,
  CreateKnowledgeInput,
  KnowledgeListFilters,
  KnowledgeSummary,
} from "@domain/knowledge/model";

/** Knowledge 持久层接口 */
export interface KnowledgeRepository {
  summary(workspaceId?: string): KnowledgeSummary;
  list(filters?: KnowledgeListFilters): KnowledgeEntry[];
  findById(id: string): KnowledgeEntry | undefined;
  search(query: string, filters?: KnowledgeListFilters): KnowledgeSearchResult[];
  create(input: CreateKnowledgeInput): KnowledgeEntry;
}

/** Knowledge 内存存储实现 */
export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private entries = new Map<string, KnowledgeEntry>();

  summary(workspaceId?: string): KnowledgeSummary {
    let globalCount = 0;
    let workspaceCount = 0;

    for (const entry of this.entries.values()) {
      if (entry.scope === "global") {
        globalCount++;
      } else if (workspaceId && entry.workspace_id === workspaceId) {
        workspaceCount++;
      }
    }

    return { global_count: globalCount, workspace_count: workspaceCount };
  }

  list(filters?: KnowledgeListFilters): KnowledgeEntry[] {
    let result = [...this.entries.values()];

    if (filters?.scope) {
      result = result.filter(e => e.scope === filters.scope);
    }
    if (filters?.workspace_id) {
      result = result.filter(e => e.workspace_id === filters.workspace_id);
    }

    result.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    return result.slice(offset, offset + limit);
  }

  findById(id: string): KnowledgeEntry | undefined {
    return this.entries.get(id);
  }

  search(query: string, filters?: KnowledgeListFilters): KnowledgeSearchResult[] {
    const lowerQuery = query.toLowerCase();
    return this.list(filters)
      .filter(e => e.title.toLowerCase().includes(lowerQuery) || e.content.toLowerCase().includes(lowerQuery))
      .map(e => ({
        ...e,
        snippet: this.generateSnippet(e.content, query),
      }));
  }

  create(input: CreateKnowledgeInput): KnowledgeEntry {
    if (this.entries.has(input.id)) {
      throw new Error(`Knowledge entry already exists: ${input.id}`);
    }

    const now = new Date().toISOString();
    const entry: KnowledgeEntry = {
      id: input.id,
      scope: input.scope,
      workspace_id: input.workspace_id ?? null,
      title: input.title,
      content: input.content,
      source_evolution_item_id: input.source_evolution_item_id ?? null,
      created_at: now,
      updated_at: now,
    };

    this.entries.set(entry.id, entry);
    return entry;
  }

  private generateSnippet(content: string, query: string): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);

    if (index === -1) {
      return content.slice(0, 100) + "...";
    }

    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + query.length + 50);
    const snippet = content.slice(start, end);

    return (start > 0 ? "..." : "") + snippet + (end < content.length ? "..." : "");
  }
}
