import { randomUUID } from "crypto";
import type {
  EvolutionItem,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
} from "@domain/evolution/model";
import { EvolutionStatus, EVOLUTION_ITEM_ID_KEY } from "@domain/evolution/model";
import type { EvolutionPort, UpdateEvolutionItemInput } from "@domain/evolution/port";
import type { EvolutionRepository } from "@domain/evolution/_internal/repository";
import type { IssuePort } from "@domain/issue/port";

/**
 * Evolution 适配器。
 *
 * 职责：候选入库、查询、状态管理、基于 item 创建 issue。
 * IssuePort 为必需依赖 — createIssue() 内部调用。
 */
export class EvolutionAdapter implements EvolutionPort {
  constructor(
    private repo: EvolutionRepository,
    private issuePort: IssuePort,
  ) {}

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

  createIssue(itemId: string): EvolutionItem {
    const item = this.repo.findById(itemId);
    if (!item) throw new Error(`Evolution item not found: ${itemId}`);
    if (item.status !== EvolutionStatus.Candidate) {
      throw new Error(`Cannot create issue for item in status "${item.status}", must be "candidate"`);
    }

    const issue = this.issuePort.createIssue({
      workspace_path: item.workspace_id,
      title: `[Evolution] ${item.title}`,
      summary: item.content,
      adopted_sop_key: "evolution",
      extendable_context: { [EVOLUTION_ITEM_ID_KEY]: item.id },
    });

    this.repo.update(itemId, {
      issue_id: issue.id,
      status: EvolutionStatus.InProgress,
      updated_at: new Date().toISOString(),
    });

    return this.repo.findById(itemId)!;
  }
}
