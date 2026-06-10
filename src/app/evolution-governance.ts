import { randomUUID } from "crypto";
import type { EvolutionItem } from "@domain/evolution/model";
import type { EvolutionAdapter } from "@domain/evolution/_internal/adapter";
import type { IssueAdapter } from "@domain/issue/_internal/adapter";
import type { IMAdapter } from "@domain/im/_internal/adapter";
import type { SopAdapter } from "@domain/sop/_internal/adapter";

/** 演进执行者角色名称 */
const EVOLUTION_ROLE_NAME = "演进执行者";
const HUMAN_ROLE_NAME = "项目负责人";

/** 治理流程输入 */
export interface GovernanceInput {
  workspace_id: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: unknown;
}

/** 治理流程输出 */
export interface GovernanceOutput {
  evolution_item: EvolutionItem;
  issue_id: string;
  stage_id: string;
  conversation_id: string;
}

/**
 * Evolution 治理流程编排。
 * 跨模块业务场景：创建 evolution_item + issue + stage + conversation。
 */
export class EvolutionGovernance {
  constructor(
    private evolutionAdapter: EvolutionAdapter,
    private issueAdapter: IssueAdapter,
    private imAdapter: IMAdapter,
    private sopAdapter: SopAdapter,
  ) {}

  /** 创建治理管线（原子创建 4 条记录） */
  createGovernancePipeline(input: GovernanceInput): GovernanceOutput {
    const now = new Date().toISOString();

    // 1. 创建 evolution_item
    const evolutionItem = this.evolutionAdapter.create({
      id: randomUUID(),
      workspace_id: input.workspace_id,
      title: input.title,
      content: input.content,
      tags: input.tags,
      metadata: input.metadata,
    });

    // 2. 获取 evolution SOP
    const sop = this.sopAdapter.findByKey("evolution");
    if (!sop) {
      throw new Error("Evolution SOP not found");
    }

    // 3. 创建 issue（使用 evolution SOP）
    const issueResult = this.issueAdapter.create({
      workspace_id: input.workspace_id,
      title: `[Evolution] ${input.title}`,
      summary: input.content.slice(0, 200),
      adopted_sop_id: "evolution",
      role_snail_mapping: {},
    });

    // 4. 更新 evolution_item.issue_id
    this.evolutionAdapter.update(evolutionItem.id, {
      issue_id: issueResult.issue.id,
    });

    return {
      evolution_item: this.evolutionAdapter.findById(evolutionItem.id)!,
      issue_id: issueResult.issue.id,
      stage_id: issueResult.stage.id,
      conversation_id: issueResult.conversation.id,
    };
  }
}

/** 初始化 Evolution 治理模块 */
export function initGovernance(
  evolutionAdapter: EvolutionAdapter,
  issueAdapter: IssueAdapter,
  imAdapter: IMAdapter,
  sopAdapter: SopAdapter,
) {
  return new EvolutionGovernance(evolutionAdapter, issueAdapter, imAdapter, sopAdapter);
}
