import { randomUUID } from "crypto";
import {
  expandRoleInstances,
  resolveDefaultRoleInstance,
  type Issue,
  type CreateIssueInput,
  type Stage,
  type CreateStageInput,
  type RoleSnailAssignment,
  type StagePreview,
} from "@domain/issue/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { IssueRepository, StageRepository, RoleSnailAssignmentRepository } from "@domain/issue/_internal/repository";
import type { SopPort } from "@domain/sop/port";
import type { Sop } from "@domain/sop/model";

// ── Issue Adapter ─────────────────────────────────────────────────────

export class IssueAdapter implements IssuePort {
  constructor(
    private issueRepo: IssueRepository,
    private sopPort: SopPort,
  ) {}

  findIssue(id: string): Issue | undefined {
    return this.issueRepo.findById(id);
  }

  listIssues(workspacePath: string, limit?: number, offset?: number): Issue[] {
    return this.issueRepo.listByWorkspace(workspacePath, limit, offset);
  }

  createIssue(input: CreateIssueInput): Issue {
    const sop = this.sopPort.findByKey(input.adopted_sop_key);
    if (!sop) throw new Error(`SOP not found: ${input.adopted_sop_key}`);

    const now = new Date().toISOString();
    const issue: Issue = {
      id: randomUUID(),
      workspace_path: input.workspace_path,
      title: input.title,
      summary: input.summary ?? null,
      sop_snapshot: structuredClone(sop),
      extendable_context: input.extendable_context ?? {},
      created_at: now,
      closed_at: null,
    };
    this.issueRepo.create(issue);
    return issue;
  }
}

// ── Stage Adapter ─────────────────────────────────────────────────────

export class StageAdapter implements StagePort {
  constructor(
    private stageRepo: StageRepository,
    private sessionRepo: RoleSnailAssignmentRepository,
    private issueRepo: IssueRepository,
  ) {}

  findStage(id: string): Stage | undefined {
    return this.stageRepo.findById(id);
  }

  listStages(issueId: string): Stage[] {
    return this.stageRepo.listByIssue(issueId);
  }

  previewStage(issueId: string, stageKey: string): StagePreview {
    const issue = this.issueRepo.findById(issueId);
    if (!issue) throw new Error(`Issue not found: ${issueId}`);

    const stageDef = issue.sop_snapshot.stage_definitions.find(sd => sd.key === stageKey);
    if (!stageDef) throw new Error(`Stage definition not found: ${stageKey} in SOP ${issue.sop_snapshot.key}`);

    const availableTransitions = this.resolveTransitions(issue.sop_snapshot, stageDef.key);

    const roleInstances = stageDef.roles.flatMap(roleDef => {
      const count = roleDef.count <= 1 ? 1 : roleDef.count;
      return Array.from({ length: count }, (_, i) => ({
        role_key: roleDef.key,
        role_instance: count <= 1 ? roleDef.name : `${roleDef.name}-${i + 1}`,
        description: roleDef.description,
      }));
    });

    return {
      key: stageDef.key,
      title: `${issue.title} . ${stageDef.key}`,
      description: stageDef.description,
      available_transitions: availableTransitions,
      role_instances: roleInstances,
    };
  }

  createStage(input: CreateStageInput): Stage {
    const issue = this.issueRepo.findById(input.issue_id);
    if (!issue) throw new Error(`Issue not found: ${input.issue_id}`);

    const stageDef = issue.sop_snapshot.stage_definitions.find(sd => sd.key === input.key);
    if (!stageDef) throw new Error(`Stage definition not found: ${input.key} in SOP ${issue.sop_snapshot.key}`);

    const roleInstances = expandRoleInstances(stageDef.roles);
    const defaultRoleInstance = resolveDefaultRoleInstance(stageDef.roles);
    const availableTransitions = this.resolveTransitions(issue.sop_snapshot, stageDef.key);

    // 校验 snail_assignments 覆盖所有 role_instances
    for (const instance of roleInstances) {
      if (!input.snail_assignments[instance]) {
        throw new Error(`Missing snail assignment for role instance: ${instance}`);
      }
    }

    const now = new Date().toISOString();
    const stageId = randomUUID();

    // 创建 Stage
    const stage: Stage = {
      id: stageId,
      workspace_path: issue.workspace_path,
      issue_id: issue.id,
      key: stageDef.key,
      title: `${issue.title} . ${stageDef.key}`,
      description: stageDef.description,
      default_role_instance: defaultRoleInstance,
      role_instances: roleInstances,
      from_stage_id: input.from_stage_id ?? null,
      available_transitions: availableTransitions,
      output_artifacts: {},
      entered_at: now,
      left_at: null,
    };
    this.stageRepo.create(stage);

    // 创建初始 RoleSnailAssignment（seq=0）
    for (const roleDef of stageDef.roles) {
      const instances = roleDef.count <= 1
        ? [roleDef.name]
        : Array.from({ length: roleDef.count }, (_, i) => `${roleDef.name}-${i + 1}`);

      for (const instance of instances) {
        this.sessionRepo.append({
          stage_id: stageId,
          role_instance: instance,
          seq: 0,
          snail_key: input.snail_assignments[instance],
          snail_instance_id: null,
          role_key: roleDef.key,
          description: roleDef.description,
          created_at: now,
        });
      }
    }

    return stage;
  }

  addOutputArtifacts(stageId: string, artifacts: Record<string, string>): void {
    const stage = this.stageRepo.findById(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    Object.assign(stage.output_artifacts, artifacts);
  }

  advanceStage(currentStageId: string, targetKey: string, snailAssignments: Record<string, string>): Stage {
    const current = this.stageRepo.findById(currentStageId);
    if (!current) throw new Error(`Stage not found: ${currentStageId}`);

    const transition = current.available_transitions.find(t => t.to === targetKey);
    if (!transition) throw new Error(`Transition to "${targetKey}" not available from stage "${current.key}"`);

    current.left_at = new Date().toISOString();

    return this.createStage({
      issue_id: current.issue_id,
      key: targetKey,
      from_stage_id: current.id,
      snail_assignments: snailAssignments,
    });
  }

  switchSnail(stageId: string, roleInstance: string, newSnailId: string): void {
    const stage = this.stageRepo.findById(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    if (!stage.role_instances.includes(roleInstance)) {
      throw new Error(`Role instance "${roleInstance}" not found in stage "${stage.key}"`);
    }

    const latest = this.sessionRepo.getLatest(stageId, roleInstance);
    if (!latest) throw new Error(`RoleSnailAssignment not found: ${stageId}:${roleInstance}`);

    this.sessionRepo.append({
      stage_id: stageId,
      role_instance: roleInstance,
      seq: latest.seq + 1,
      snail_key: newSnailId,
      snail_instance_id: null,
      role_key: latest.role_key,
      description: latest.description,
      created_at: new Date().toISOString(),
    });
  }

  setSnailInstanceId(stageId: string, roleInstance: string, snailInstanceId: string): void {
    this.sessionRepo.setSnailInstanceId(stageId, roleInstance, snailInstanceId);
  }

  getRoleSnailAssignments(stageId: string): RoleSnailAssignment[] {
    return this.sessionRepo.listLatestByStage(stageId);
  }

  getRoleSnailAssignment(stageId: string, roleInstance: string): RoleSnailAssignment | null {
    return this.sessionRepo.getLatest(stageId, roleInstance);
  }

  getRoleHandbook(stageId: string, roleKey: string): string | null {
    const stage = this.stageRepo.findById(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);

    const issue = this.issueRepo.findById(stage.issue_id);
    if (!issue) throw new Error(`Issue not found: ${stage.issue_id}`);

    const stageDef = issue.sop_snapshot.stage_definitions.find(sd => sd.key === stage.key);
    if (!stageDef) return null;

    const roleDef = stageDef.roles.find(r => r.key === roleKey);
    return roleDef?.handbook ?? null;
  }

  private resolveTransitions(sop: Sop, stageKey: string) {
    return sop.transitions
      .filter(t => t.from === stageKey)
      .map(t => ({ to: t.to, guard: t.guard }));
  }
}
