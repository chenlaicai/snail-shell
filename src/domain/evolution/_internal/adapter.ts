import { randomUUID } from "crypto";
import type {
  EvolutionItem,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
} from "@domain/evolution/model";
import { EvolutionStatus, EVOLUTION_ITEM_ID_KEY } from "@domain/evolution/model";
import type { EvolutionPort, UpdateEvolutionItemInput, CreateIssueFn } from "@domain/evolution/port";
import type { EvolutionRepository } from "@domain/evolution/_internal/repository";
import type { IssuePort } from "@domain/issue/port";
import type { IssueSnailAssignmentPlan } from "@domain/issue/model";
import type { SnailPort } from "@domain/snail/port";

/**
 * Evolution 适配器。
 *
 * 职责：候选入库、查询、状态管理、基于 item 创建 issue。
 * IssuePort 为必需依赖 — previewSopStages() 内部用于生成 snail assignment plan。
 */
export class EvolutionAdapter implements EvolutionPort {
  constructor(
    private repo: EvolutionRepository,
    private issuePort: IssuePort,
    private snailPort: SnailPort,
    private createIssueFn: CreateIssueFn,
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

  async createIssue(itemId: string): Promise<EvolutionItem> {
    const item = this.repo.findById(itemId);
    if (!item) throw new Error(`Evolution item not found: ${itemId}`);
    if (item.status !== EvolutionStatus.Candidate) {
      throw new Error(`Cannot create issue for item in status "${item.status}", must be "candidate"`);
    }

    const { issue } = await this.createIssueFn({
      workspace_path: item.workspace_id,
      title: `[Evolution] ${item.title}`,
      summary: item.content,
      adopted_sop_key: "evolution",
      snail_assignment_plan: this.createDefaultSnailAssignmentPlan("evolution", `[Evolution] ${item.title}`),
      context: { [EVOLUTION_ITEM_ID_KEY]: item.id },
    });

    this.repo.update(itemId, {
      issue_id: issue.id,
      status: EvolutionStatus.InProgress,
      updated_at: new Date().toISOString(),
    });

    return this.repo.findById(itemId)!;
  }

  private createDefaultSnailAssignmentPlan(adoptedSopKey: string, title: string): IssueSnailAssignmentPlan {
    const snail = this.snailPort.list()[0];
    if (!snail) throw new Error("Cannot create evolution issue without configured snails");

    const plan: IssueSnailAssignmentPlan = {};
    for (const stage of this.issuePort.previewSopStages(adoptedSopKey, title)) {
      plan[stage.key] = {};
      for (const role of stage.role_instances) {
        plan[stage.key][role.role_instance] = snail.key;
      }
    }
    return plan;
  }
}
