import { randomUUID } from "crypto";
import type { Conversation, ConversationStore, Feature, Workspace, Stage } from "../persistence/store";
import type { RoleRegistry } from "../roles";

export interface FeatureWorkflowResult {
  feature: Feature;
  stage: Stage;
  conversation: Conversation;
}

export interface FeatureAdvanceResult {
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
    sopId?: string;
    roleBindings: Record<string, string>;
    defaultSopKey?: string;
  },
): { workspace: Workspace; feature: Feature; stage: Stage; conversation: Conversation } {
  const { name, summary, workspaceRoot, workspaceId, module = "workspace_management", sopId, roleBindings, defaultSopKey } = input;

  const resolvedSopId = resolveSopId(deps, sopId, defaultSopKey);
  const sop = deps.store.getSop(resolvedSopId);
  if (!sop) {
    throw new Error(`SOP not found: ${resolvedSopId}`);
  }
  assertSopHasRequiredStages(deps, resolvedSopId);
  assertRoleBindingsCoverSop(deps, resolvedSopId, roleBindings);

  const workspace = deps.store.createWorkspace(workspaceId ?? randomUUID(), module, name, workspaceRoot, summary);

  deps.store.createWorkspaceSop({
    id: `ps-${workspace.id}-${resolvedSopId}`,
    workspaceId: workspace.id,
    sopId: resolvedSopId,
    isDefault: true,
    roleBindings,
  });
  deps.roleRegistry.reloadFromStore();

  const featureWorkflow = createFeatureWorkflow(deps, { workspace: workspace, title: "初始研发迭代", summary: "项目创建时自动生成的默认 feature。" });
  return { workspace: workspace, ...featureWorkflow };
}

const REQUIRED_STAGE_KEYS = ["development", "review"] as const;

function assertSopHasRequiredStages(deps: WorkflowDependencies, sopId: string): void {
  for (const key of REQUIRED_STAGE_KEYS) {
    if (!deps.store.getSopStageDefinitionByKey(sopId, key)) {
      throw new Error(`SOP ${sopId} is missing required stage "${key}". Workspace creation requires both "development" and "review" stages.`);
    }
  }
}

function assertRoleBindingsCoverSop(deps: WorkflowDependencies, sopId: string, roleBindings: Record<string, string>): void {
  const sopRoles = deps.store.listSopRoleDefinitions(sopId);
  const sopRoleKeys = new Set(sopRoles.map((r) => r.key));
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

function resolveSopId(deps: WorkflowDependencies, sopId: string | undefined, defaultSopKey: string | undefined): string {
  if (sopId) return sopId;
  if (!defaultSopKey) {
    throw new Error("No sopId provided and no defaultSopKey configured. Cannot create workspace without an SOP.");
  }
  const defaultSop = deps.store.getGlobalSopByKey(defaultSopKey);
  if (!defaultSop) {
    throw new Error(`Default SOP not found: global SOP with key "${defaultSopKey}" does not exist. Check defaultSopForNewWorkspaces in workspace-config-seed.json.`);
  }
  return defaultSop.id;
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
  const stage = createFeatureStage(deps, { workspace: input.workspace, feature, stageKey: "development", sequence: 1, sopId: resolvedSopId });
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

export function advanceFeatureWorkflow(
  deps: WorkflowDependencies,
  workspace: Workspace,
  feature: Feature,
  activeStage: Stage
): FeatureAdvanceResult {
  const completedStage = deps.store.updateStage(activeStage.id, {
    status: "completed",
    left_at: new Date().toISOString(),
  });

  if (activeStage.type === "review") {
    return { completed_stage: completedStage, next_stage: null, conversation: null, feature };
  }

  const fromConversationIds = deps.store.listConversationsByStage(activeStage.id).map((item) => item.id);
  const nextStage = createFeatureStage(deps, { workspace: workspace, feature, stageKey: "review", sequence: activeStage.sequence + 1, sopId: feature.adopted_sop_id });
  snapshotRoleSnailMapping(deps, workspace.id, feature.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { workspace: workspace, feature, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature };
}

export function restartFeatureDevelopmentWorkflow(
  deps: WorkflowDependencies,
  workspace: Workspace,
  feature: Feature,
  activeStage: Stage
): FeatureAdvanceResult {
  const completedStage = deps.store.updateStage(activeStage.id, {
    status: "completed",
    left_at: new Date().toISOString(),
  });
  const fromConversationIds = deps.store.listConversationsByStage(activeStage.id).map((item) => item.id);
  const nextStage = createFeatureStage(deps, { workspace: workspace, feature, stageKey: "development", sequence: activeStage.sequence + 1, sopId: feature.adopted_sop_id });
  snapshotRoleSnailMapping(deps, workspace.id, feature.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { workspace: workspace, feature, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature };
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
