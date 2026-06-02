import { randomUUID } from "crypto";
import type { Conversation, ConversationStore, Issue, Workspace, Stage, StageGateEvidence, StageGateArtifact, StageChecklistItem } from "../persistence/store";
import type { RoleRegistry } from "../roles";
import { logger } from "../logger";

export interface IssueWorkflowResult {
  issue: Issue;
  stage: Stage;
  conversation: Conversation;
}

export interface IssueAdvanceResult {
  completed_stage: Stage;
  next_stage: Stage | null;
  conversation: Conversation | null;
  issue: Issue;
}

interface WorkflowDependencies {
  store: ConversationStore;
  roleRegistry: RoleRegistry;
}

export function createInitialWorkflow(
  deps: WorkflowDependencies,
  input: {
    name: string;
    summary?: string;
    workspaceRoot: string;
    workspaceId?: string;
    module?: string;
    /** SOP ID，创建 workspace 时必须显式指定。 */
    sopId: string;
    roleBindings: Record<string, string | string[]>;
  },
): { workspace: Workspace; issue: Issue; stage: Stage; conversation: Conversation } {
  const { name, summary, workspaceRoot, workspaceId, module = "workspace_management", sopId, roleBindings } = input;

  const sop = deps.store.getSop(sopId);
  if (!sop) {
    throw new Error(`SOP not found: ${sopId}`);
  }
  assertSopHasRequiredStages(deps, sopId);
  assertRoleBindingsCoverSop(deps, sopId, roleBindings);

  const workspace = deps.store.createWorkspace(workspaceId ?? randomUUID(), module, name, workspaceRoot, summary);

  deps.store.createWorkspaceSop({
    id: `ps-${workspace.id}-${sopId}`,
    workspaceId: workspace.id,
    sopId,
    isDefault: true,
    roleBindings,
  });
  deps.roleRegistry.reloadFromStore();

  const issueWorkflow = createIssueWorkflow(deps, { workspace: workspace, title: "初始设计与实现", summary: "工作区创建时自动生成的默认 issue。" });
  return { workspace: workspace, ...issueWorkflow };
}

/** code-delivery SOP 的 4 个必需阶段 key，按 sequence 顺序。 */
const REQUIRED_STAGE_KEYS = ["design", "development", "review", "merge"] as const;

/** 阶段推进路由表：当前 stage key → 下一个 stage key。null 表示流程结束。 */
const STAGE_ADVANCE_ROUTE: Record<string, string | null> = {
  design: "development",
  development: "review",
  review: "merge",
  merge: null,
};

/** 允许的打回路径：from stage key → target stage key。 */
const STAGE_BOUNCE_ROUTE: Record<string, string> = {
  development: "design",
  review: "design",
  merge: "review",
};

function assertSopHasRequiredStages(deps: WorkflowDependencies, sopId: string): void {
  for (const key of REQUIRED_STAGE_KEYS) {
    if (!deps.store.getSopStageDefinitionByKey(sopId, key)) {
      throw new Error(`SOP ${sopId} is missing required stage "${key}". Workspace creation requires "design", "development", "review" and "merge" stages.`);
    }
  }
}


function assertRoleBindingsCoverSop(deps: WorkflowDependencies, sopId: string, roleBindings: Record<string, string | string[]>): void {
  const sopRoleKeys = deps.store.collectSopRoleKeys(sopId);
  const bindingKeys = new Set(Object.keys(roleBindings));
  for (const key of bindingKeys) {
    if (!sopRoleKeys.has(key)) {
      throw new Error(`role_bindings contains unknown role key "${key}". SOP ${sopId} defines roles: ${[...sopRoleKeys].join(", ")}`);
    }
  }
  for (const key of sopRoleKeys) {
    if (!bindingKeys.has(key)) {
      throw new Error(`role_bindings is missing required role "${key}". SOP ${sopId} requires bindings for: ${[...sopRoleKeys].join(", ")}`);
    }
  }
}

export function createIssueWorkflow(
  deps: WorkflowDependencies,
  input: { workspace: Workspace; title: string; summary?: string; fromConversationIds?: string[]; adoptedSopId?: string }
): IssueWorkflowResult {
  let resolvedSopId: string;
  if (input.adoptedSopId) {
    const binding = deps.store.getWorkspaceSop(input.workspace.id, input.adoptedSopId);
    if (!binding) {
      throw new Error(`SOP ${input.adoptedSopId} is not bound to workspace ${input.workspace.id}. Assign it via workspace_sop first.`);
    }
    resolvedSopId = input.adoptedSopId;
  } else {
    const defaultSop = deps.store.getDefaultWorkspaceSop(input.workspace.id);
    if (!defaultSop) {
      throw new Error(`No default SOP configured for workspace ${input.workspace.id}. Assign a default SOP via workspace_sop before creating issues.`);
    }
    resolvedSopId = defaultSop.sop_id;
  }
  const issue = deps.store.createIssue({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    title: input.title,
    summary: input.summary,
    adoptedSopId: resolvedSopId,
  });
  const stage = createIssueStage(deps, { workspace: input.workspace, issue, stageKey: "design", sequence: 1, sopId: resolvedSopId });
  snapshotRoleSnailMapping(deps, input.workspace.id, issue.id, stage);
  const conversation = createDefaultStageConversation(deps, { workspace: input.workspace, issue, stage, fromConversationIds: input.fromConversationIds ?? [] });
  return { issue, stage, conversation };
}

export function createStageConversation(
  deps: WorkflowDependencies,
  input: {
    workspaceId: string;
    issueId: string;
    stageId: string;
    title: string;
    kind: Conversation["kind"];
    fromConversationIds?: string[];
    summary?: string;
  }
): Conversation {
  const stage = deps.store.getStage(input.stageId);
  if (!stage || stage.workspace_id !== input.workspaceId || stage.issue_id !== input.issueId) {
    throw new Error(`Stage not found: ${input.stageId}`);
  }

  const roles = deps.store.listRoleDefinitionsByStageAndWorkspace(stage.stage_definition_id, input.workspaceId);
  const primaryRole = roles.find((r) => r.is_primary === 1) ?? roles[0];
  if (!primaryRole) {
    throw new Error(`No roles configured for stage definition: ${stage.stage_definition_id} in workspace ${input.workspaceId}`);
  }
  return deps.store.createConversation({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    issueId: input.issueId,
    stageId: input.stageId,
    title: input.title,
    kind: input.kind,
    defaultRole: primaryRole.name,
    participatingRoles: ["Boss Role", ...roles.map((role) => role.name)],
    summary: input.summary,
    fromConversationIds: input.fromConversationIds,
  });
}

export function advanceIssueWorkflow(
  deps: WorkflowDependencies,
  workspace: Workspace,
  issue: Issue,
  activeStage: Stage
): IssueAdvanceResult {
  checkGateEvidence(deps, activeStage);
  const completedStage = deps.store.updateStage(activeStage.id, {
    status: "completed",
    left_at: new Date().toISOString(),
  });

  const nextStageKey = STAGE_ADVANCE_ROUTE[activeStage.type];
  if (nextStageKey === null) {
    /** merge 是最后阶段，推进即完成 issue。 */
    return { completed_stage: completedStage, next_stage: null, conversation: null, issue };
  }
  if (nextStageKey === undefined) {
    throw new Error(`Unknown stage type "${activeStage.type}" cannot advance. Valid types: ${Object.keys(STAGE_ADVANCE_ROUTE).join(", ")}`);
  }

  const fromConversationIds = deps.store.listConversationsByStage(activeStage.id).map((item) => item.id);
  const nextStage = createIssueStage(deps, { workspace: workspace, issue, stageKey: nextStageKey, sequence: activeStage.sequence + 1, sopId: issue.adopted_sop_id });
  snapshotRoleSnailMapping(deps, workspace.id, issue.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { workspace: workspace, issue, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, issue };
}

/**
 * 从当前 stage 打回到指定目标 stage。
 *
 * 打回路径由 STAGE_BOUNCE_ROUTE 约束：
 * - development → design（编码时发现设计不足）
 * - review → design（检视时发现设计问题）
 * - merge → review（硬性条件不通过）
 *
 * 打回时完成当前 stage，创建目标 stage 的新实例（sequence 递增）。
 */
export function bounceIssueWorkflow(
  deps: WorkflowDependencies,
  workspace: Workspace,
  issue: Issue,
  activeStage: Stage
): IssueAdvanceResult {
  const targetStageKey = STAGE_BOUNCE_ROUTE[activeStage.type];
  if (!targetStageKey) {
    throw new Error(`Stage "${activeStage.type}" cannot bounce. Allowed bounce sources: ${Object.keys(STAGE_BOUNCE_ROUTE).join(", ")}`);
  }

  const completedStage = deps.store.updateStage(activeStage.id, {
    status: "completed",
    left_at: new Date().toISOString(),
  });
  const fromConversationIds = deps.store.listConversationsByStage(activeStage.id).map((item) => item.id);
  const nextStage = createIssueStage(deps, { workspace: workspace, issue, stageKey: targetStageKey, sequence: activeStage.sequence + 1, sopId: issue.adopted_sop_id });
  snapshotRoleSnailMapping(deps, workspace.id, issue.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { workspace: workspace, issue, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, issue };
}

function createIssueStage(
  deps: WorkflowDependencies,
  input: { workspace: Workspace; issue: Issue; stageKey: string; sequence: number; sopId: string | null }
): Stage {
  const stageDef = input.sopId
    ? deps.store.getSopStageDefinitionByKey(input.sopId, input.stageKey)
    : deps.store.getStageDefinitionByKey(input.workspace.id, input.stageKey);
  if (!stageDef) {
    throw new Error(`Stage definition not found: ${input.stageKey} for ${input.sopId ? `SOP ${input.sopId}` : `workspace ${input.workspace.id}`}`);
  }
  return deps.store.createStage({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    issueId: input.issue.id,
    stageDefinitionId: stageDef.id,
    type: stageDef.key,
    sequence: input.sequence,
    status: "in_progress",
    enteredAt: new Date().toISOString(),
  });
}

function createDefaultStageConversation(
  deps: WorkflowDependencies,
  input: { workspace: Workspace; issue: Issue; stage: Stage; fromConversationIds: string[] }
): Conversation {
  const roles = deps.store.listRoleDefinitionsByStageAndWorkspace(input.stage.stage_definition_id, input.workspace.id);
  const primaryRole = roles.find((r) => r.is_primary === 1) ?? roles[0];
  if (!primaryRole) {
    throw new Error(`No roles configured for stage definition: ${input.stage.stage_definition_id} in workspace ${input.workspace.id}`);
  }
  return deps.store.createConversation({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    issueId: input.issue.id,
    stageId: input.stage.id,
    title: `${input.issue.title} · ${input.stage.type} #${input.stage.sequence}`,
    kind: "discussion",
    defaultRole: primaryRole.name,
    participatingRoles: ["Boss Role", ...roles.map((role) => role.name)],
    summary: `Auto-created conversation for issue ${input.issue.title} stage ${input.stage.type}`,
    fromConversationIds: input.fromConversationIds,
  });
}

function snapshotRoleSnailMapping(deps: WorkflowDependencies, workspaceId: string, issueId: string, stage: Stage): void {
  const roles = deps.store.listRoleDefinitionsByStageAndWorkspace(stage.stage_definition_id, workspaceId);
  const stageMapping: Record<string, string> = {};
  for (const role of roles) {
    if (role.snail_template_id) {
      stageMapping[role.name] = role.snail_template_id;
    }
  }
  const issue = deps.store.getIssue(issueId);
  if (!issue) return;
  const updated = { ...issue.role_snail_mapping, [stage.id]: stageMapping };
  deps.store.updateIssue(issueId, { role_snail_mapping: updated });
}

/**
 * 推进前检查 gate_evidence。
 *
 * Why: 让 AI 在阶段结束前自动检查产出完整性，人工只需最终确认。
 * 如有未通过的必需项，log.warn 提示但不阻塞——用户有最终决定权。
 */
function checkGateEvidence(deps: WorkflowDependencies, activeStage: Stage): void {
  const stageDef = deps.store.getStageDefinition(activeStage.stage_definition_id);
  if (!stageDef) return;

  const checklist: StageChecklistItem[] = stageDef.acceptance_checklist;
  if (!checklist || checklist.length === 0) return;

  const evidence: StageGateEvidence | null = activeStage.gate_evidence;
  if (!evidence || !evidence.items || evidence.items.length === 0) {
    logger.warn(`Stage ${activeStage.type} (#${activeStage.sequence}) has no gate evidence. Acceptance checklist has ${checklist.length} items.`);
    return;
  }

  const requiredItems = checklist.filter((item) => item.required);
  const missing = requiredItems.filter((item) => {
    const artifact = evidence.items.find((a: StageGateArtifact) => a.checklistId === item.id);
    return !artifact || artifact.status !== "passed";
  });

  if (missing.length > 0) {
    const missingDescriptions = missing.map((item) => item.description).join("; ");
    logger.warn(`Stage ${activeStage.type} (#${activeStage.sequence}) has ${missing.length} unresolved required gate items: ${missingDescriptions}`);
  }
}
