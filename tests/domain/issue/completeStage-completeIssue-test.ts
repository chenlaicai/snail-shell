import assert from "assert";
import { randomUUID } from "crypto";
import { StageAdapter } from "@domain/issue/_internal/adapter";
import type { Issue, Stage } from "@domain/issue/model";
import type { IssueRepository, StageRepository, RoleSnailAssignmentRepository } from "@domain/issue/_internal/repository";
import type { Sop } from "@domain/sop/model";
import { Scope } from "@domain/workspace/model";

// ── Test Helpers ──────────────────────────────────────────────────────

function createMockIssueRepo(): IssueRepository & { issues: Map<string, Issue> } {
  const issues = new Map<string, Issue>();
  return {
    issues,
    findById(id: string): Issue | undefined {
      return issues.get(id);
    },
    listByWorkspace(): Issue[] {
      return [...issues.values()];
    },
    create(issue: Issue): void {
      issues.set(issue.id, issue);
    },
    update(issueId: string, updates: Partial<Pick<Issue, "closed_at">>): void {
      const issue = issues.get(issueId);
      if (!issue) throw new Error(`Issue not found: ${issueId}`);
      if (updates.closed_at !== undefined) {
        issue.closed_at = updates.closed_at;
      }
    },
  };
}

function createMockStageRepo(): StageRepository & { stages: Map<string, Stage> } {
  const stages = new Map<string, Stage>();
  return {
    stages,
    findById(id: string): Stage | undefined {
      return stages.get(id);
    },
    listByIssue(issueId: string): Stage[] {
      return [...stages.values()].filter(s => s.issue_id === issueId);
    },
    create(stage: Stage): void {
      stages.set(stage.id, stage);
    },
    update(stageId: string, updates: Partial<Pick<Stage, "left_at" | "output_artifacts">>): void {
      const stage = stages.get(stageId);
      if (!stage) throw new Error(`Stage not found: ${stageId}`);
      if (updates.left_at !== undefined) stage.left_at = updates.left_at;
      if (updates.output_artifacts !== undefined) stage.output_artifacts = updates.output_artifacts;
    },
    transaction<T>(fn: () => T): T {
      return fn();
    },
  };
}

function createSopWithTransitions(key: string, stageKeys: string[], transitions: Array<{ from: string; to: string }>): Sop {
  return {
    key,
    name: `Test SOP ${key}`,
    description: null,
    shared_handbook: null,
    stage_definitions: stageKeys.map((stageKey, index) => ({
      key: stageKey,
      title: `Stage ${stageKey}`,
      description: `Description for ${stageKey}`,
      sequence: index + 1,
      input_description: null,
      output_description: null,
      acceptance_focus: [],
      roles: [{ key: "executor", name: "Executor", description: "Executes tasks", is_primary: true, count: 1, handbook: null }],
    })),
    transitions: transitions.map(t => ({ ...t, guard: null })),
    scope: Scope.Platform,
  };
}

function createIssueWithStage(
  issueRepo: ReturnType<typeof createMockIssueRepo>,
  stageRepo: ReturnType<typeof createMockStageRepo>,
  sop: Sop,
  stageKey: string,
  stageOverrides?: Partial<Stage>,
): { issue: Issue; stage: Stage } {
  const issueId = randomUUID();
  const stageId = randomUUID();
  const now = new Date().toISOString();

  const issue: Issue = {
    id: issueId,
    workspace_path: "/test/workspace",
    title: "Test Issue",
    summary: null,
    sop_snapshot: structuredClone(sop),
    snail_assignment_plan: {},
    extendable_context: {},
    created_at: now,
    closed_at: null,
  };
  issueRepo.create(issue);

  const stageDef = sop.stage_definitions.find(sd => sd.key === stageKey)!;
  const availableTransitions = sop.transitions
    .filter(t => t.from === stageKey)
    .map(t => ({ to: t.to, guard: null }));

  const stage: Stage = {
    id: stageId,
    workspace_path: issue.workspace_path,
    issue_id: issueId,
    key: stageKey,
    title: `${issue.title} . ${stageKey}`,
    description: stageDef.description,
    default_role_instance: "executor",
    role_instances: ["executor"],
    from_stage_id: null,
    available_transitions: availableTransitions,
    output_artifacts: {},
    entered_at: now,
    left_at: null,
    ...stageOverrides,
  };
  stageRepo.create(stage);

  return { issue, stage };
}

// ── Tests ─────────────────────────────────────────────────────────────

console.log("Running completeStage and completeIssue tests...\n");

// B1: 终端阶段进行中可调用 completeStage
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "merge"], [{ from: "design", to: "merge" }]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  const { stage } = createIssueWithStage(issueRepo, stageRepo, sop, "merge");

  const completed = adapter.completeStage(stage.id);
  assert(completed.left_at !== null, "B1: completeStage should set left_at");
  assert.equal(completed.id, stage.id, "B1: completeStage should return the same stage");
  console.log("✓ B1: 终端阶段进行中可调用 completeStage");
}

// B2: 终端阶段已完成可调用 completeIssue
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "merge"], [{ from: "design", to: "merge" }]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  const { issue, stage } = createIssueWithStage(issueRepo, stageRepo, sop, "merge");
  stageRepo.update(stage.id, { left_at: new Date().toISOString() });

  const completed = adapter.completeIssue(issue.id);
  assert(completed.closed_at !== null, "B2: completeIssue should set closed_at");
  assert.equal(completed.id, issue.id, "B2: completeIssue should return the same issue");
  console.log("✓ B2: 终端阶段已完成可调用 completeIssue");
}

// B3: 非终端阶段调用 completeStage 应拒绝
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "development", "merge"], [
    { from: "design", to: "development" },
    { from: "development", to: "merge" },
  ]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  const { stage } = createIssueWithStage(issueRepo, stageRepo, sop, "design");

  assert.throws(
    () => adapter.completeStage(stage.id),
    /Stage is not a terminal stage/,
    "B3: completeStage should reject non-terminal stages"
  );
  console.log("✓ B3: 非终端阶段调用 completeStage 应拒绝");
}

// B4: 阶段进行中调用 completeIssue 应拒绝
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "merge"], [{ from: "design", to: "merge" }]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  const { issue } = createIssueWithStage(issueRepo, stageRepo, sop, "merge");

  assert.throws(
    () => adapter.completeIssue(issue.id),
    /Stage is still in progress/,
    "B4: completeIssue should reject when stage is still in progress"
  );
  console.log("✓ B4: 阶段进行中调用 completeIssue 应拒绝");
}

// B5: 单阶段 SOP 支持完成
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("evolution", ["development"], []);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  const { issue, stage } = createIssueWithStage(issueRepo, stageRepo, sop, "development");

  const completedStage = adapter.completeStage(stage.id);
  assert(completedStage.left_at !== null, "B5: completeStage should work for single-stage SOP");

  const completedIssue = adapter.completeIssue(issue.id);
  assert(completedIssue.closed_at !== null, "B5: completeIssue should work for single-stage SOP");
  console.log("✓ B5: 单阶段 SOP 支持完成");
}

// B6: 终端阶段判定使用 stage_definitions 数组索引
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "development", "review", "merge"], [
    { from: "design", to: "development" },
    { from: "development", to: "review" },
    { from: "review", to: "merge" },
    { from: "merge", to: "review" },  // 反向转换
  ]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  // merge 有反向转换到 review，但没有正向转换，应该是终端阶段
  const { stage: mergeStage } = createIssueWithStage(issueRepo, stageRepo, sop, "merge");
  const completed = adapter.completeStage(mergeStage.id);
  assert(completed.left_at !== null, "B6: merge with only backward transition should be terminal");
  console.log("✓ B6: 终端阶段判定使用 stage_definitions 数组索引");
}

// B7: 有反向转换但无正向转换的阶段可调用 completeStage
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "development", "review", "merge"], [
    { from: "design", to: "development" },
    { from: "development", to: "review" },
    { from: "review", to: "merge" },
    { from: "merge", to: "review" },
    { from: "review", to: "development" },
  ]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  // review 有反向转换到 development，也有正向转换到 merge，不是终端阶段
  const { stage: reviewStage } = createIssueWithStage(issueRepo, stageRepo, sop, "review");
  assert.throws(
    () => adapter.completeStage(reviewStage.id),
    /Stage is not a terminal stage/,
    "B7: review with forward transition should not be terminal"
  );

  // merge 只有反向转换到 review，是终端阶段
  const { stage: mergeStage } = createIssueWithStage(issueRepo, stageRepo, sop, "merge");
  const completed = adapter.completeStage(mergeStage.id);
  assert(completed.left_at !== null, "B7: merge with only backward transition should be terminal");
  console.log("✓ B7: 有反向转换但无正向转换的阶段可调用 completeStage");
}

// B8: Issue 已完成时所有操作应拒绝
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "merge"], [{ from: "design", to: "merge" }]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  // 使用 design 阶段（非终端，有正向转换），以便测试 advanceStage
  const { issue, stage } = createIssueWithStage(issueRepo, stageRepo, sop, "design");
  issueRepo.update(issue.id, { closed_at: new Date().toISOString() });

  assert.throws(
    () => adapter.completeStage(stage.id),
    /Issue is already completed/,
    "B8: completeStage should reject completed issue"
  );

  assert.throws(
    () => adapter.completeIssue(issue.id),
    /Issue is already completed/,
    "B8: completeIssue should reject completed issue"
  );

  assert.throws(
    () => adapter.advanceStage(stage.id, "merge"),
    /Issue is already completed/,
    "B8: advanceStage should reject completed issue"
  );
  console.log("✓ B8: Issue 已完成时所有操作应拒绝");
}

// B9: 阶段已完成时 completeStage 应拒绝
{
  const issueRepo = createMockIssueRepo();
  const stageRepo = createMockStageRepo();
  const sop = createSopWithTransitions("sop-test", ["design", "merge"], [{ from: "design", to: "merge" }]);
  const adapter = new StageAdapter(stageRepo, {} as RoleSnailAssignmentRepository, issueRepo);

  const { stage } = createIssueWithStage(issueRepo, stageRepo, sop, "merge");
  stageRepo.update(stage.id, { left_at: new Date().toISOString() });

  assert.throws(
    () => adapter.completeStage(stage.id),
    /Stage is already completed/,
    "B9: completeStage should reject already completed stage"
  );
  console.log("✓ B9: 阶段已完成时 completeStage 应拒绝");
}

console.log("\n✓ All tests passed!");
