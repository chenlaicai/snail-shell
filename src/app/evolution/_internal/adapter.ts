import type { EvolutionItem } from "@domain/evolution/model";
import { EvolutionStatus, EVOLUTION_ITEM_ID_KEY } from "@domain/evolution/model";
import type { EvolutionPort } from "@domain/evolution/port";
import type { IssueSnailAssignmentPlan } from "@domain/issue/model";
import type { IssuePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import type { EvolutionAppPort } from "@app/evolution/port";

/**
 * Evolution App 适配器（编排层）。
 *
 * 职责：基于 evolution item 创建 issue，协调 domain/evolution + app/issue-collaboration。
 */
export class EvolutionAppAdapter implements EvolutionAppPort {
  constructor(
    private evolutionPort: EvolutionPort,
    private collaboration: CollaborationInput,
    private issuePort: IssuePort,
    private snailPort: SnailPort,
  ) {}

  async createIssueFromItem(itemId: string): Promise<EvolutionItem> {
    const item = this.evolutionPort.findById(itemId);
    if (!item) throw new Error(`Evolution item not found: ${itemId}`);
    if (item.status !== EvolutionStatus.Candidate) {
      throw new Error(`Cannot create issue for item in status "${item.status}", must be "candidate"`);
    }

    const { issue } = await this.collaboration.createIssue({
      workspace_path: item.workspace_id,
      title: `[Evolution] ${item.title}`,
      summary: item.content,
      adopted_sop_key: "evolution",
      snail_assignment_plan: this.createDefaultSnailAssignmentPlan("evolution", `[Evolution] ${item.title}`),
      context: { [EVOLUTION_ITEM_ID_KEY]: item.id },
    });

    return this.evolutionPort.update(itemId, {
      status: EvolutionStatus.InProgress,
      issue_id: issue.id,
    });
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
