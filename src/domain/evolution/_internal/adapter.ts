import { randomUUID } from "crypto";
import type {
  EvolutionItem,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
} from "@domain/evolution/model";
import { EvolutionStatus } from "@domain/evolution/model";
import type { EvolutionPort, UpdateEvolutionItemInput } from "@domain/evolution/port";
import type { EvolutionRepository } from "@domain/evolution/_internal/repository";

/**
 * Evolution 适配器（纯数据层）。
 *
 * 职责：候选入库、查询、状态管理。
 * 编排逻辑（createIssue）已移至 app/evolution。
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
      id: randomUUID(),
      workspace_id: input.workspace_id,
      status: EvolutionStatus.Candidate,
      issue_id: null,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      result: null,
      metadata: input.metadata ?? null,
      created_at: now,
      updated_at: now,
    };

    this.repo.create(item);
    return item;
  }

  update(id: string, updates: UpdateEvolutionItemInput): EvolutionItem {
    const item = this.repo.findById(id);
    if (!item) throw new Error(`Evolution item not found: ${id}`);

    if (updates.status !== undefined && !Object.values(EvolutionStatus).includes(updates.status as EvolutionStatus)) {
      throw new Error(`Invalid evolution status: "${updates.status}". Valid: ${Object.values(EvolutionStatus).join(", ")}`);
    }

    this.repo.update(id, {
      status: updates.status as EvolutionStatus | undefined,
      result: updates.result,
      updated_at: new Date().toISOString(),
    });

    return this.repo.findById(id)!;
  }
}
