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

export interface StageDefinitionInput {
  key: string;
  title: string;
  sequence: number;
  input_description?: string | null;
  output_description?: string | null;
  acceptance_focus?: string[];
  roles: Array<{
    name: string;
    snail_template_id: string;
    is_primary?: boolean;
    description?: string;
    working_rules?: string[];
  }>;
}

export const REQUIRED_FEATURE_WORKFLOW_STAGE_KEYS = ["development", "review"] as const;

export function assertRequiredFeatureWorkflowStages(stageDefinitions: StageDefinitionInput[] | undefined): void {
  if (!stageDefinitions?.length) return;
  const stageKeys = new Set(stageDefinitions.map((stage) => stage.key));
  for (const requiredKey of REQUIRED_FEATURE_WORKFLOW_STAGE_KEYS) {
    if (!stageKeys.has(requiredKey)) {
      throw new Error(`stage_definitions must include required workflow stage: ${requiredKey}`);
    }
  }
}

export function createInitialWorkflow(
  deps: WorkflowDependencies,
  input: { name: string; summary?: string; projectRoot: string; projectId?: string; module?: string; stageDefinitions?: StageDefinitionInput[] },
): { project: Project; feature: Feature; stage: Stage; conversation: Conversation } {
  const { name, summary, projectRoot, projectId, module = "project_management", stageDefinitions } = input;
  assertRequiredFeatureWorkflowStages(stageDefinitions);
  const project = deps.store.createProject(projectId ?? randomUUID(), module, name, projectRoot, summary);
  if (stageDefinitions?.length) {
    deps.store.seedStageDefinitionsForProject(project.id, stageDefinitions.map((sd, index) => ({
      id: `${project.id}-${sd.key}`,
      key: sd.key,
      title: sd.title,
      sequence: sd.sequence ?? index + 1,
      input_description: sd.input_description ?? null,
      output_description: sd.output_description ?? null,
      acceptance_focus: sd.acceptance_focus ?? [],
      roles: sd.roles.map((r, ri) => ({
        id: `${project.id}-${sd.key}-${ri}`,
        name: r.name,
        snail_template_id: r.snail_template_id,
        is_primary: r.is_primary ?? false,
        description: r.description ?? "",
        working_rules: r.working_rules ?? [],
      })),
    })));
    // 重新加载 RoleRegistry 以包含新项目的角色定义
    deps.roleRegistry.reloadFromStore();
  }
  const featureWorkflow = createFeatureWorkflow(deps, { project, title: "初始研发迭代", summary: "项目创建时自动生成的默认 feature。" });
  return { project, ...featureWorkflow };
}

export function createFeatureWorkflow(
  deps: WorkflowDependencies,
  input: { project: Project; title: string; summary?: string; fromConversationIds?: string[] }
): FeatureWorkflowResult {
  const feature = deps.store.createFeature({
    id: randomUUID(),
    projectId: input.project.id,
    title: input.title,
    summary: input.summary,
  });
  const stage = createFeatureStage(deps, { project: input.project, feature, stageKey: "development", sequence: 1 });
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

  const primaryRole = deps.roleRegistry.getPrimaryForStageType(input.projectId, stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.projectId,
    featureId: input.featureId,
    stageId: input.stageId,
    title: input.title,
    kind: input.kind,
    defaultRole: primaryRole.name,
    participatingRoles: ["Boss Role", ...deps.roleRegistry.listByStageType(input.projectId, stage.type).map((role) => role.name)],
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
  const nextStage = createFeatureStage(deps, { project, feature, stageKey: "review", sequence: activeStage.sequence + 1 });
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
  const nextStage = createFeatureStage(deps, { project, feature, stageKey: "development", sequence: activeStage.sequence + 1 });
  snapshotRoleSnailMapping(deps, project.id, feature.id, nextStage);
  const conversation = createDefaultStageConversation(deps, { project, feature, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature };
}

function createFeatureStage(
  deps: WorkflowDependencies,
  input: { project: Project; feature: Feature; stageKey: string; sequence: number }
): Stage {
  const stageDef = deps.store.getStageDefinitionByKey(input.project.id, input.stageKey);
  if (!stageDef) {
    throw new Error(`Stage definition not found: ${input.stageKey} for project ${input.project.id}`);
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
  const primaryRole = deps.roleRegistry.getPrimaryForStageType(input.project.id, input.stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.project.id,
    featureId: input.feature.id,
    stageId: input.stage.id,
    title: `${input.feature.title} · ${input.stage.type} #${input.stage.sequence}`,
    kind: "discussion",
    defaultRole: primaryRole.name,
    participatingRoles: ["Boss Role", ...deps.roleRegistry.listByStageType(input.project.id, input.stage.type).map((role) => role.name)],
    summary: `Auto-created conversation for feature ${input.feature.title} stage ${input.stage.type}`,
    fromConversationIds: input.fromConversationIds,
  });
}

function snapshotRoleSnailMapping(deps: WorkflowDependencies, projectId: string, featureId: string, stage: Stage): void {
  const roles = deps.roleRegistry.listByStageType(projectId, stage.type);
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
