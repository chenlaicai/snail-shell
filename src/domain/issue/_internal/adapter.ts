import { randomUUID } from "crypto";
import type { Issue, Stage, CreateIssueInput, CreateIssueResult, SopSnapshot } from "@domain/issue/model";
import type { IssuePort } from "@domain/issue/port";
import type { SopRepository } from "@domain/sop/_internal/repository";
import type { IMRepository } from "@domain/im/_internal/repository";
import type { IssueRepository, StageRepository } from "./repository";

/** 人类操作者角色名称 */
const HUMAN_ROLE_NAME = "项目负责人";

/**
 * Issue 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class IssueAdapter implements IssuePort {
  constructor(
    private issueRepo: IssueRepository,
    private stageRepo: StageRepository,
    private sopRepo: SopRepository,
    private imRepo: IMRepository,
  ) {}

  findById(id: string): Issue | undefined {
    return this.issueRepo.findById(id);
  }

  listByWorkspace(workspaceId: string, limit?: number, offset?: number): Issue[] {
    return this.issueRepo.listByWorkspace(workspaceId, limit, offset);
  }

  create(input: CreateIssueInput): CreateIssueResult {
    // 1. 获取 SOP
    const sop = this.sopRepo.findByKey(input.adopted_sop_id);
    if (!sop) {
      throw new Error(`SOP not found: ${input.adopted_sop_id}`);
    }

    // 2. 构建 SOP 快照
    const sopSnapshot: SopSnapshot = {
      sop_id: sop.key,
      name: sop.name,
      description: sop.description,
      first_stage: sop.first_stage,
      shared_handbook: sop.shared_handbook,
      stage_definitions: sop.stage_definitions.map(sd => ({
        key: sd.key,
        title: sd.title,
        sequence: sd.sequence,
        input_description: sd.input_description,
        output_description: sd.output_description,
        acceptance_focus: sd.acceptance_focus,
        acceptance_checklist: sd.acceptance_checklist,
        roles: sd.roles.map(r => ({
          key: r.key,
          name: r.name,
          description: r.description,
          is_primary: r.is_primary,
          count: r.count,
          handbook: r.handbook,
        })),
      })),
      transitions: sop.transitions.map(t => ({
        from: t.from,
        to: t.to,
        guard: t.guard,
      })),
    };

    // 3. 创建 Issue
    const now = new Date().toISOString();
    const issue: Issue = {
      id: randomUUID(),
      workspace_id: input.workspace_id,
      title: input.title,
      summary: input.summary ?? null,
      task_anchor: null,
      sop_snapshot: sopSnapshot,
      role_snail_mapping: input.role_snail_mapping,
      created_at: now,
      updated_at: now,
      closed_at: null,
    };
    this.issueRepo.create(issue);

    // 4. 解析第一个 Stage
    const firstStageKey = sopSnapshot.first_stage ?? sopSnapshot.stage_definitions[0]?.key;
    if (!firstStageKey) {
      throw new Error("SOP has no stage definitions");
    }

    const stageDef = sopSnapshot.stage_definitions.find(sd => sd.key === firstStageKey);
    if (!stageDef) {
      throw new Error(`Stage definition not found: ${firstStageKey}`);
    }

    // 5. 创建 Stage
    const stage: Stage = {
      id: randomUUID(),
      workspace_id: input.workspace_id,
      issue_id: issue.id,
      stage_definition_id: stageDef.key,
      type: stageDef.key,
      sequence: 1,
      status: "in_progress",
      output_artifacts: {},
      gate_evidence: null,
      entered_at: now,
      left_at: null,
    };
    this.stageRepo.create(stage);

    // 6. 创建默认 Conversation
    const primaryRole = stageDef.roles.find(r => r.is_primary) ?? stageDef.roles[0];
    const participatingRoles = [
      HUMAN_ROLE_NAME,
      ...stageDef.roles.map(r => r.name),
    ];

    const conversation = this.imRepo.createConversation({
      id: randomUUID(),
      workspace_id: input.workspace_id,
      issue_id: issue.id,
      stage_id: stage.id,
      owner_type: "workspace_stage",
      owner_id: stage.id,
      title: `${issue.title} . ${stage.type} #${stage.sequence}`,
      kind: "discussion",
      default_role: primaryRole?.name ?? HUMAN_ROLE_NAME,
      participating_roles: participatingRoles,
      summary: `Auto-created conversation for issue ${issue.title} stage ${stage.type}`,
      from_conversation_ids: [],
    });

    return { issue, stage, conversation };
  }

  findStageById(id: string): Stage | undefined {
    return this.stageRepo.findById(id);
  }

  listStages(issueId: string): Stage[] {
    return this.stageRepo.listByIssue(issueId);
  }
}
