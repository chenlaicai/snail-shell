import type {
  EvolutionItem,
  CreateEvolutionItemInput,
  UpdateEvolutionItemInput,
  EvolutionItemListFilters,
} from "@domain/evolution/model";
import type { EvolutionPort } from "@domain/evolution/port";
import { InMemoryEvolutionRepository, type EvolutionRepository } from "./repository";

/**
 * Evolution 适配器实现。
 * 只负责 evolution_item 的 CRUD。
 */
export class EvolutionAdapter implements EvolutionPort {
  constructor(private repo: EvolutionRepository) {}

  findById(id: string): EvolutionItem | undefined {
    return this.repo.findById(id);
  }

  list(filters?: EvolutionItemListFilters): EvolutionItem[] {
    return this.repo.list(filters);
  }

  search(query: string, filters?: EvolutionItemListFilters): EvolutionItem[] {
    return this.repo.search(query, filters);
  }

  create(input: CreateEvolutionItemInput): EvolutionItem {
    const now = new Date().toISOString();
    const item: EvolutionItem = {
      id: input.id,
      workspace_id: input.workspace_id,
      issue_id: null,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      metadata: input.metadata ?? null,
      created_at: now,
      updated_at: now,
    };

    this.repo.create(item);
    return item;
  }

  update(id: string, input: UpdateEvolutionItemInput): EvolutionItem {
    this.repo.update(id, input);
    const item = this.repo.findById(id);
    if (!item) {
      throw new Error(`Evolution item not found: ${id}`);
    }
    return item;
  }
}

/** 初始化 Evolution 模块 */
export function init() {
  const repo = new InMemoryEvolutionRepository();
  const adapter = new EvolutionAdapter(repo);
  return { repo, adapter };
}
