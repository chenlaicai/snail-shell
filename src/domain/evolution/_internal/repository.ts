import type {
  EvolutionItem,
  EvolutionItemListFilters,
} from "@domain/evolution/model";

/** Evolution 持久层接口 */
export interface EvolutionRepository {
  findById(id: string): EvolutionItem | undefined;
  list(filters?: EvolutionItemListFilters): EvolutionItem[];
  search(query: string, filters?: EvolutionItemListFilters): EvolutionItem[];
  create(item: EvolutionItem): void;
  update(id: string, updates: Partial<Pick<EvolutionItem, "status" | "issue_id" | "result" | "updated_at">>): void;
}

/** Evolution 内存存储实现 */
export class InMemoryEvolutionRepository implements EvolutionRepository {
  private items = new Map<string, EvolutionItem>();

  findById(id: string): EvolutionItem | undefined {
    return this.items.get(id);
  }

  list(filters?: EvolutionItemListFilters): EvolutionItem[] {
    let result = [...this.items.values()];

    if (filters?.workspace_id) {
      result = result.filter(i => i.workspace_id === filters.workspace_id);
    }
    if (filters?.status) {
      result = result.filter(i => i.status === filters.status);
    }
    if (filters?.tags?.length) {
      result = result.filter(i => filters.tags!.some(t => i.tags.includes(t)));
    }

    result.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    return result.slice(offset, offset + limit);
  }

  search(query: string, filters?: EvolutionItemListFilters): EvolutionItem[] {
    const lowerQuery = query.toLowerCase();
    return this.list(filters)
      .filter(i => i.title.toLowerCase().includes(lowerQuery) || i.content.toLowerCase().includes(lowerQuery));
  }

  create(item: EvolutionItem): void {
    if (this.items.has(item.id)) {
      throw new Error(`Evolution item already exists: ${item.id}`);
    }
    this.items.set(item.id, item);
  }

  update(id: string, updates: Partial<Pick<EvolutionItem, "status" | "issue_id" | "result" | "updated_at">>): void {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Evolution item not found: ${id}`);
    }
    if (updates.status !== undefined) item.status = updates.status;
    if (updates.issue_id !== undefined) item.issue_id = updates.issue_id;
    if (updates.result !== undefined) item.result = updates.result;
    item.updated_at = updates.updated_at ?? new Date().toISOString();
  }
}
