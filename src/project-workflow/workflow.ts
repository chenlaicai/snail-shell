import { randomUUID } from "crypto";
import type { Conversation, ConversationStore, Feature, Project, Stage } from "../persistence/store";
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
    projectRoot: string;
    projectId?: string;
    module?: string;
    sopId?: string;
    roleBindings: Record<string, string>;
    defaultSopKey?: string;
  },
): { project: Project; feature: Feature; stage: Stage; conversation: Conversation } {
  const { name, summary, projectRoot, projectId, module = "project_management", sopId, roleBindings, defaultSopKey } = input;

  const resolvedSopId = resolveSopId(deps, sopId, defaultSopKey);
  const sop = deps.store.getSop(resolvedSopId);
  if (!sop) {
    throw new Error(`SOP not found: ${resolvedSopId}`);
  }
  assertSopHasRequiredStages(deps, resolvedSopId);

  const project = deps.store.createProject(projectId ?? randomUUID(), module, name, projectRoot, summary);

  deps.store.createProjectSop({
    id: `ps-${project.id}-${resolvedSopId}`,
    projectId: project.id,
    sopId: resolvedSopId,
    isDefault: true,
    roleBindings,
  });
  deps.roleRegistry.reloadFromStore();

  const featureWorkflow = createFeatureWorkflow(deps, { project, title: "初始研发迭代", summary: "项目创建时自动生成的默认 feature。" });
  return { project, ...featureWorkflow };
}

const REQUIRED_STAGE_KEYS = ["development", "review"] as const;

function assertSopHasRequiredStages(deps: WorkflowDependencies, sopId: string): void {
  for (const key of REQUIRED_STAGE_KEYS) {
    if (!deps.store.getSopStageDefinitionByKey(sopId, key)) {
      throw new Error(`SOP ${sopId} is missing required stage "${key}". Project creation requires both "development" and "review" stages.`);
    }
  }
}

function resolveSopId(deps: WorkflowDependencies, sopId: string | undefined, defaultSopKey: string | undefined): string {
  if (sopId) return sopId;
  if (!defaultSopKey) {
    throw new Error("No sopId provided and no defaultSopKey configured. Cannot create project without an SOP.");
  }
  const defaultSop = deps.store.getGlobalSopByKey(defaultSopKey);
  if (!defaultSop) {
    throw new Error(`Default SOP not found: global SOP with key "${defaultSopKey}" does not exist. Check defaultSopForNewProjects in project-config-seed.json.`);
  }
  return defaultSop.id;
}

export function createFeatureWorkflow(
  deps: WorkflowDependencies,
  input: { project: Project; title: string; summary?: string; fromConversationIds?: string[]; adoptedSopId?: string }
): FeatureWorkflowResult {
  let resolvedSopId: string;
  if (input.adoptedSopId) {
    const binding = deps.store.getProjectSop(input.project.id, input.adoptedSopId);
    if (!binding) {
      throw new Error(`SOP ${input.adoptedSopId} is not bound to project ${input.project.id}. Assign it via project_sop first.`);
    }
    resolvedSopId = input.adoptedSopId;
  } else {
    const defaultSop = deps.store.getDefaultProjectSop(input.project.id);
    if (!defaultSop) {
      throw new Error(`No default SOP configured for project ${input.project.id}. Assign a default SOP via project_sop before creating features.`);
    }
    resolvedSopId = defaultSop.sop_id;
  }
  const feature = deps.store.createFeature({
    id: randomUUID(),
    projectId: input.project.id,
    title: input.title,
    summary: input.summary,
    adoptedSopId: resolvedSopId,
  });
  const stage = createFeatureStage(deps, { project: input.project, feature, stageKey: "development", sequence: 1, sopId: resolvedSopId });
  snapshotRoleSnailMapping(deps, input.project.id, feature.id, stage);
  const conversation = createDefaultStageConversation(deps, { project: input.project, feature, stage, fromConversationIds: input.fromConversationIds ?? [] });
  return { feature, stage, conversation };
}

export function createStageConversation(
  deps: WorkflowDependencies,
  input: {
    projectId: string;
    featureId: string;
    stageId: string;
    title: string;
    kind: Conversation["kind"];
    fromConversationIds?: string[];
    summary?: string;
  }
): Conversation {
  const stage = deps.store.getStage(input.stageId);
  if (!stage || stage.project_id !== input.projectId || stage.feature_id !== input.featureId) {
    throw new Error(`Stage not found: ${input.stageId}`);
  }

  const roles = deps.store.listRoleDefinitionsByStageAndProject(stage.stage_definition_id, input.projectId);
  const primaryRole = roles.find((r) => r.is_primary === 1) ?? roles[0];
  if (!primaryRole) {
    throw new Error(`No roles configured for stage definition: ${stage.stage_definition_id} in project ${input.projectId}`);
  }
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.projectId,
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
  project: Project,
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
  const nextStage = createFeatureStage(deps, { project, feature, stageKey: "review", sequence: activeStage.sequence + 1, sopId: feature.adopted_sop_id });
  snapshotRoleSnailMapping(deps, project.id, feature.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { project, feature, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature };
}

export function restartFeatureDevelopmentWorkflow(
  deps: WorkflowDependencies,
  project: Project,
  feature: Feature,
  activeStage: Stage
): FeatureAdvanceResult {
  const completedStage = deps.store.updateStage(activeStage.id, {
    status: "completed",
    left_at: new Date().toISOString(),
  });
  const fromConversationIds = deps.store.listConversationsByStage(activeStage.id).map((item) => item.id);
  const nextStage = createFeatureStage(deps, { project, feature, stageKey: "development", sequence: activeStage.sequence + 1, sopId: feature.adopted_sop_id });
  snapshotRoleSnailMapping(deps, project.id, feature.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { project, feature, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature };
}

function createFeatureStage(
  deps: WorkflowDependencies,
  input: { project: Project; feature: Feature; stageKey: string; sequence: number; sopId: string | null }
): Stage {
  const stageDef = input.sopId
    ? deps.store.getSopStageDefinitionByKey(input.sopId, input.stageKey)
    : deps.store.getStageDefinitionByKey(input.project.id, input.stageKey);
  if (!stageDef) {
    throw new Error(`Stage definition not found: ${input.stageKey} for ${input.sopId ? `SOP ${input.sopId}` : `project ${input.project.id}`}`);
  }
  return deps.store.createStage({
    id: randomUUID(),
    projectId: input.project.id,
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
  input: { project: Project; feature: Feature; stage: Stage; fromConversationIds: string[] }
): Conversation {
  const roles = deps.store.listRoleDefinitionsByStageAndProject(input.stage.stage_definition_id, input.project.id);
  const primaryRole = roles.find((r) => r.is_primary === 1) ?? roles[0];
  if (!primaryRole) {
    throw new Error(`No roles configured for stage definition: ${input.stage.stage_definition_id} in project ${input.project.id}`);
  }
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.project.id,
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

function snapshotRoleSnailMapping(deps: WorkflowDependencies, projectId: string, featureId: string, stage: Stage): void {
  const roles = deps.store.listRoleDefinitionsByStageAndProject(stage.stage_definition_id, projectId);
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
