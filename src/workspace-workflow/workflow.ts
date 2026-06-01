import { randomUUID } from "crypto";
import type { Conversation, ConversationStore, Feature, Workspace, Stage, StageGateEvidence, StageGateArtifact, StageChecklistItem, SopTransition } from "../persistence/store";
import type { RoleRegistry } from "../roles";
import { logger } from "../logger";

export interface FeatureWorkflowResult {
  feature: Feature;
  stage: Stage;
  conversation: Conversation;
}

export interface FeatureTransitionResult {
  completed_stage: Stage;
  next_stage: Stage | null;
  conversation: Conversation | null;
  feature: Feature;
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
): { workspace: Workspace; feature: Feature; stage: Stage; conversation: Conversation } {
  const { name, summary, workspaceRoot, workspaceId, module = "workspace_management", sopId, roleBindings } = input;

  const sop = deps.store.getSop(sopId);
  if (!sop) {
    throw new Error(`SOP not found: ${sopId}`);
  }
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

  const featureWorkflow = createFeatureWorkflow(deps, { workspace: workspace, title: "初始设计与实现", summary: "工作区创建时自动生成的默认 feature。" });
  return { workspace: workspace, ...featureWorkflow };
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

export function createFeatureWorkflow(
  deps: WorkflowDependencies,
  input: { workspace: Workspace; title: string; summary?: string; fromConversationIds?: string[]; adoptedSopId?: string }
): FeatureWorkflowResult {
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
      throw new Error(`No default SOP configured for workspace ${input.workspace.id}. Assign a default SOP via workspace_sop before creating features.`);
    }
    resolvedSopId = defaultSop.sop_id;
  }
  const feature = deps.store.createFeature({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    title: input.title,
    summary: input.summary,
    adoptedSopId: resolvedSopId,
  });
  const sop = deps.store.getSop(resolvedSopId);
  const firstStageKey = sop?.first_stage ?? resolveFirstStageKey(deps, resolvedSopId);
  const stage = createFeatureStage(deps, { workspace: input.workspace, feature, stageKey: firstStageKey, sequence: 1, sopId: resolvedSopId });
  snapshotRoleSnailMapping(deps, input.workspace.id, feature.id, stage);
  const conversation = createDefaultStageConversation(deps, { workspace: input.workspace, feature, stage, fromConversationIds: input.fromConversationIds ?? [] });
  return { feature, stage, conversation };
}

export function createStageConversation(
  deps: WorkflowDependencies,
  input: {
    workspaceId: string;
    featureId: string;
    stageId: string;
    title: string;
    kind: Conversation["kind"];
    fromConversationIds?: string[];
    summary?: string;
  }
): Conversation {
  const stage = deps.store.getStage(input.stageId);
  if (!stage || stage.workspace_id !== input.workspaceId || stage.feature_id !== input.featureId) {
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
    featureId: input.featureId,
    stageId: input.stageId,
    title: input.title,
    kind: input.kind,
    defaultRole: primaryRole.name,
    participatingRoles: ["Boss Role", ...roles.map((role) => role.name)],
    summary: input.summary,
    fromConversationIds: input.fromConversationIds,
  });
}

/**
 * 统一的 stage 转移函数。替代原 advanceFeatureWorkflow 和 bounceFeatureWorkflow。
 *
 * 转移流程：
 * 1. 解析目标 stage（自动或显式指定）
 * 2. 校验 guard（requires_artifacts 等）
 * 3. 校验转移边存在于 sop_transition 表
 * 4. 完成当前 stage
 * 5. 创建目标 stage + conversation
 */
export function transitionFeatureStage(
  deps: WorkflowDependencies,
  ctx: { workspace: Workspace; feature: Feature; activeStage: Stage; targetStageKey?: string },
): FeatureTransitionResult {
  const { workspace, feature, activeStage, targetStageKey } = ctx;
  const resolvedTarget = resolveTransitionTarget(deps, feature, activeStage, targetStageKey);
  const edge = deps.store.validateTransition(feature.adopted_sop_id!, activeStage.type, resolvedTarget);
  checkGuard(deps, activeStage, edge);
  checkGateEvidence(deps, activeStage);

  const completedStage = deps.store.updateStage(activeStage.id, { status: "completed", left_at: new Date().toISOString() });
  const fromConversationIds = deps.store.listConversationsByStage(activeStage.id).map((item) => item.id);
  const nextStage = createFeatureStage(deps, { workspace, feature, stageKey: resolvedTarget, sequence: activeStage.sequence + 1, sopId: feature.adopted_sop_id });
  snapshotRoleSnailMapping(deps, workspace.id, feature.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { workspace, feature, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature };
}

function resolveTransitionTarget(deps: WorkflowDependencies, feature: Feature, activeStage: Stage, targetStageKey?: string): string {
  if (!feature.adopted_sop_id) throw new Error(`Feature ${feature.id} has no adopted SOP, cannot transition`);
  const forwardEdges = deps.store.getForwardTransitions(feature.adopted_sop_id, activeStage.type);
  if (forwardEdges.length === 0) throw new Error(`Stage "${activeStage.type}" has no forward transitions in SOP ${feature.adopted_sop_id}.`);
  if (targetStageKey) return targetStageKey;
  if (forwardEdges.length === 1) return forwardEdges[0].to_stage_key;
  const targets = forwardEdges.map((e) => e.to_stage_key).join(", ");
  throw new Error(`Stage "${activeStage.type}" has multiple forward transitions (${targets}). Specify target_stage_key.`);
}

function createFeatureStage(
  deps: WorkflowDependencies,
  input: { workspace: Workspace; feature: Feature; stageKey: string; sequence: number; sopId: string | null }
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
    featureId: input.feature.id,
    stageDefinitionId: stageDef.id,
    type: stageDef.key,
    sequence: input.sequence,
    status: "in_progress",
    enteredAt: new Date().toISOString(),
  });
}

function createDefaultStageConversation(
  deps: WorkflowDependencies,
  input: { workspace: Workspace; feature: Feature; stage: Stage; fromConversationIds: string[] }
): Conversation {
  const roles = deps.store.listRoleDefinitionsByStageAndWorkspace(input.stage.stage_definition_id, input.workspace.id);
  const primaryRole = roles.find((r) => r.is_primary === 1) ?? roles[0];
  if (!primaryRole) {
    throw new Error(`No roles configured for stage definition: ${input.stage.stage_definition_id} in workspace ${input.workspace.id}`);
  }
  return deps.store.createConversation({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    featureId: input.feature.id,
    stageId: input.stage.id,
    title: `${input.feature.title} · ${input.stage.type} #${input.stage.sequence}`,
    kind: "discussion",
    defaultRole: primaryRole.name,
    participatingRoles: ["Boss Role", ...roles.map((role) => role.name)],
    summary: `Auto-created conversation for feature ${input.feature.title} stage ${input.stage.type}`,
    fromConversationIds: input.fromConversationIds,
  });
}

function snapshotRoleSnailMapping(deps: WorkflowDependencies, workspaceId: string, featureId: string, stage: Stage): void {
  const roles = deps.store.listRoleDefinitionsByStageAndWorkspace(stage.stage_definition_id, workspaceId);
  const stageMapping: Record<string, string> = {};
  for (const role of roles) {
    if (role.snail_template_id) {
      stageMapping[role.name] = role.snail_template_id;
    }
  }
  const feature = deps.store.getFeature(featureId);
  if (!feature) return;
  const updated = { ...feature.role_snail_mapping, [stage.id]: stageMapping };
  deps.store.updateFeature(featureId, { role_snail_mapping: updated });
}

/**
 * 校验转移守卫。当前支持 requires_artifacts：检查当前 stage 的 output_artifacts 是否包含所需 key。
 */
function checkGuard(deps: WorkflowDependencies, activeStage: Stage, edge: SopTransition): void {
  if (!edge.guard) return;
  if (edge.guard.type === "requires_artifacts") {
    const required = edge.guard.config.artifacts as string[] | undefined;
    if (!required || required.length === 0) return;
    const artifacts = activeStage.output_artifacts ?? {};
    const missing = required.filter((key) => !artifacts[key]);
    if (missing.length > 0) {
      throw new Error(`Stage "${activeStage.type}" missing required artifacts for transition to "${edge.to_stage_key}": ${missing.join(", ")}`);
    }
  }
}

/**
 * SOP 未配置 first_stage 时，fallback 到 sequence 最小的 stage key。
 */
function resolveFirstStageKey(deps: WorkflowDependencies, sopId: string): string {
  const stages = deps.store.listSopStageDefinitions(sopId);
  if (stages.length === 0) {
    throw new Error(`SOP ${sopId} has no stage definitions`);
  }
  return stages[0].key;
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
