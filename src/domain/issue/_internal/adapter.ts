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
  type IssueSnailAssignmentPlan,
  type StageSnailAssignmentPlan,
} from "@domain/issue/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { IssueRepository, StageRepository, RoleSnailAssignmentRepository } from "@domain/issue/_internal/repository";
import type { SopPort } from "@domain/sop/port";
import type { Sop, StageDefinition } from "@domain/sop/model";

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

  previewSopStages(adoptedSopKey: string, title: string): StagePreview[] {
    const sop = this.sopPort.findByKey(adoptedSopKey);
    if (!sop) throw new Error(`SOP not found: ${adoptedSopKey}`);
    return previewSopStages(sop, title);
  }

  validateSnailAssignmentPlan(sop: Sop, plan: IssueSnailAssignmentPlan): void {
    validateSnailAssignmentPlan(sop, plan);
  }

  createIssue(input: CreateIssueInput): Issue {
    const sop = this.sopPort.findByKey(input.adopted_sop_key);
    if (!sop) throw new Error(`SOP not found: ${input.adopted_sop_key}`);
    validateSnailAssignmentPlan(sop, input.snail_assignment_plan);

    const now = new Date().toISOString();
    const issue: Issue = {
      id: randomUUID(),
      workspace_path: input.workspace_path,
      title: input.title,
      summary: input.summary ?? null,
      sop_snapshot: structuredClone(sop),
      snail_assignment_plan: structuredClone(input.snail_assignment_plan),
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
    const issue = this.mustFindIssue(issueId);
    const stageDef = findStageDefinition(issue.sop_snapshot, stageKey);
    return previewStageDefinition(issue.sop_snapshot, stageDef, issue.title);
  }

  getStageSnailAssignmentPlan(issueId: string, stageKey: string): StageSnailAssignmentPlan {
    const issue = this.mustFindIssue(issueId);
    const stagePlan = issue.snail_assignment_plan[stageKey];
    if (!stagePlan) throw new Error(`Missing snail assignment plan for stage: ${stageKey}`);
    return stagePlan;
  }

  transaction<T>(fn: () => T): T {
    return this.stageRepo.transaction(fn);
  }

  createStage(input: CreateStageInput): Stage {
    return this.createStageInTransaction(input);
  }

  private createStageInTransaction(input: CreateStageInput): Stage {
    const issue = this.mustFindIssue(input.issue_id);
    const stageDef = findStageDefinition(issue.sop_snapshot, input.key);
    const roleInstances = expandRoleInstances(stageDef.roles);
    const defaultRoleInstance = resolveDefaultRoleInstance(stageDef.roles);
    const availableTransitions = resolveTransitions(issue.sop_snapshot, stageDef.key);
    const snailAssignments = this.getStageSnailAssignmentPlan(issue.id, stageDef.key);

    validateStageSnailAssignments(stageDef, snailAssignments);

    const now = new Date().toISOString();
    const stageId = randomUUID();

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

    for (const roleDef of stageDef.roles) {
      const instances = roleDef.count <= 1
        ? [roleDef.name]
        : Array.from({ length: roleDef.count }, (_, i) => `${roleDef.name}-${i + 1}`);

      for (const instance of instances) {
        this.sessionRepo.append({
          stage_id: stageId,
          role_instance: instance,
          seq: 0,
          snail_key: snailAssignments[instance],
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
    this.stageRepo.update(stageId, { output_artifacts: stage.output_artifacts });
  }

  advanceStage(currentStageId: string, targetKey: string): Stage {
    return this.stageRepo.transaction(() => {
      const current = this.stageRepo.findById(currentStageId);
      if (!current) throw new Error(`Stage not found: ${currentStageId}`);

      const issue = this.mustFindIssue(current.issue_id);
      if (issue.closed_at) throw new Error("Issue is already completed");

      const transition = current.available_transitions.find(t => t.to === targetKey);
      if (!transition) throw new Error(`Transition to "${targetKey}" not available from stage "${current.key}"`);

      const leftAt = new Date().toISOString();
      current.left_at = leftAt;
      this.stageRepo.update(currentStageId, { left_at: leftAt });

      return this.createStageInTransaction({
        issue_id: current.issue_id,
        key: targetKey,
        from_stage_id: current.id,
      });
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

  completeStage(stageId: string): Stage {
    return this.stageRepo.transaction(() => {
      const stage = this.stageRepo.findById(stageId);
      if (!stage) throw new Error(`Stage not found: ${stageId}`);

      const issue = this.mustFindIssue(stage.issue_id);
      if (issue.closed_at) throw new Error("Issue is already completed");
      if (stage.left_at) throw new Error("Stage is already completed");

      /** 终端阶段判定：available_transitions 中不存在正向转换 */
      if (!this.isTerminalStage(issue.sop_snapshot, stage)) {
        throw new Error("Stage is not a terminal stage");
      }

      const leftAt = new Date().toISOString();
      this.stageRepo.update(stageId, { left_at: leftAt });
      return { ...stage, left_at: leftAt };
    });
  }

  completeIssue(issueId: string): Issue {
    return this.stageRepo.transaction(() => {
      const issue = this.mustFindIssue(issueId);
      if (issue.closed_at) throw new Error("Issue is already completed");

      /** 获取当前阶段（未完成的阶段） */
      const stages = this.stageRepo.listByIssue(issueId);
      if (stages.length === 0) throw new Error("Issue has no stages");
      const currentStage = stages.find(s => !s.left_at);
      if (currentStage) throw new Error("Stage is still in progress");

      const closedAt = new Date().toISOString();
      this.issueRepo.update(issueId, { closed_at: closedAt });
      return { ...issue, closed_at: closedAt };
    });
  }

  /**
   * 终端阶段判定：从该阶段出发的所有 available_transitions 中，不存在正向转换。
   * 正向/反向使用 sop_snapshot.stage_definitions 数组索引判断。
   *
   * D7 决策：信任 stage_definitions 顺序，不额外校验 currentIndex === -1 的情况。
   * 若 stage.key 不在 stage_definitions 中，currentIndex = -1，所有 targetIndex >= 0
   * 的转换都不满足 targetIndex <= -1，方法返回 false（非终端），行为安全。
   */
  private isTerminalStage(sopSnapshot: { stage_definitions: Array<{ key: string }> }, stage: Stage): boolean {
    const stageDefs = sopSnapshot.stage_definitions;
    const currentIndex = stageDefs.findIndex(d => d.key === stage.key);

    return stage.available_transitions.every(transition => {
      const targetIndex = stageDefs.findIndex(d => d.key === transition.to);
      return targetIndex <= currentIndex;
    });
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

    const issue = this.mustFindIssue(stage.issue_id);
    const stageDef = issue.sop_snapshot.stage_definitions.find(sd => sd.key === stage.key);
    if (!stageDef) return null;

    const roleDef = stageDef.roles.find(r => r.key === roleKey);
    return roleDef?.handbook ?? null;
  }

  private mustFindIssue(issueId: string): Issue {
    const issue = this.issueRepo.findById(issueId);
    if (!issue) throw new Error(`Issue not found: ${issueId}`);
    return issue;
  }
}

function previewSopStages(sop: Sop, title: string): StagePreview[] {
  return sop.stage_definitions.map(stageDef => previewStageDefinition(sop, stageDef, title));
}

function previewStageDefinition(sop: Sop, stageDef: StageDefinition, title: string): StagePreview {
  return {
    key: stageDef.key,
    title: `${title || sop.name} . ${stageDef.key}`,
    description: stageDef.description,
    available_transitions: resolveTransitions(sop, stageDef.key),
    role_instances: stageDef.roles.flatMap(roleDef => {
      const count = roleDef.count <= 1 ? 1 : roleDef.count;
      return Array.from({ length: count }, (_, i) => ({
        role_key: roleDef.key,
        role_instance: count <= 1 ? roleDef.name : `${roleDef.name}-${i + 1}`,
        description: roleDef.description,
      }));
    }),
  };
}

function validateSnailAssignmentPlan(sop: Sop, plan: IssueSnailAssignmentPlan): void {
  for (const stageDef of sop.stage_definitions) {
    validateStageSnailAssignments(stageDef, plan[stageDef.key] ?? {});
  }

  const stageKeys = new Set(sop.stage_definitions.map(stageDef => stageDef.key));
  for (const stageKey of Object.keys(plan)) {
    if (!stageKeys.has(stageKey)) throw new Error(`Unknown stage in snail assignment plan: ${stageKey}`);
  }
}

function validateStageSnailAssignments(stageDef: StageDefinition, assignments: StageSnailAssignmentPlan): void {
  const roleInstances = expandRoleInstances(stageDef.roles);
  const allowed = new Set(roleInstances);
  for (const instance of roleInstances) {
    if (!assignments[instance]) throw new Error(`Missing snail assignment for role instance: ${stageDef.key}:${instance}`);
  }
  for (const instance of Object.keys(assignments)) {
    if (!allowed.has(instance)) throw new Error(`Unknown role instance in snail assignments: ${stageDef.key}:${instance}`);
  }
}

function findStageDefinition(sop: Sop, stageKey: string): StageDefinition {
  const stageDef = sop.stage_definitions.find(sd => sd.key === stageKey);
  if (!stageDef) throw new Error(`Stage definition not found: ${stageKey} in SOP ${sop.key}`);
  return stageDef;
}

function resolveTransitions(sop: Sop, stageKey: string) {
  return sop.transitions
    .filter(t => t.from === stageKey)
    .map(t => ({ to: t.to, guard: t.guard }));
}
