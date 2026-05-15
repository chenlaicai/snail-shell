import { randomUUID } from "crypto";
import type { Conversation, ConversationStore, Feature, Project, ProjectKind, Stage } from "../persistence/store";
import type { SnailRegistry, StageRoleBinding } from "../snails";

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
  snailRegistry: SnailRegistry;
}

export interface StageDefinitionInput {
  key: string;
  title: string;
  sequence: number;
  input_description?: string | null;
  output_description?: string | null;
  acceptance_focus?: string[];
  roles: Array<{ snail_id: string; is_primary?: boolean; working_rules?: string[] }>;
}

export function createInitialWorkflow(
  deps: WorkflowDependencies,
  name: string,
  summary: string | undefined,
  kind: ProjectKind,
  stageDefinitions?: StageDefinitionInput[]
): { project: Project; feature: Feature; stage: Stage; conversation: Conversation } {
  const project = deps.store.createProject(randomUUID(), kind, name, summary);
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
        snail_id: r.snail_id,
        is_primary: r.is_primary ?? false,
        working_rules: r.working_rules ?? [],
      })),
    })));
    // Reload stage role bindings so SnailRegistry knows about the new definitions
    const allRoleDefs = deps.store.listRoleDefinitionsByProject(project.id);
    const bindings: StageRoleBinding[] = allRoleDefs.map((rd) => ({
      stageKey: deps.store.getStageDefinition(rd.stage_definition_id)?.key ?? "",
      snailId: rd.snail_id as any,
      isPrimary: Boolean(rd.is_primary),
      workingRules: rd.working_rules,
    }));
    deps.snailRegistry.loadStageRoleBindings(bindings);
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
    status: "active",
  });
  const stage = createFeatureStage(deps, { project: input.project, feature, stageKey: "development", sequence: 1 });
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

  const primarySnail = deps.snailRegistry.getPrimaryForStageType(stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.projectId,
    featureId: input.featureId,
    stageId: input.stageId,
    title: input.title,
    kind: input.kind,
    defaultSnail: primarySnail.name,
    participatingSnails: ["Boss Snail", ...deps.snailRegistry.listByStageType(stage.type).map((snail) => snail.name)],
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
    const updatedFeature = deps.store.updateFeature(feature.id, { status: "waiting_merge" });
    return { completed_stage: completedStage, next_stage: null, conversation: null, feature: updatedFeature };
  }

  const fromConversationIds = deps.store.listConversationsByStage(activeStage.id).map((item) => item.id);
  const nextStage = createFeatureStage(deps, { project, feature, stageKey: "review", sequence: activeStage.sequence + 1 });
  const conversation = createDefaultStageConversation(deps, { project, feature, stage: nextStage, fromConversationIds });
  const updatedFeature = deps.store.updateFeature(feature.id, { status: "in_review" });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature: updatedFeature };
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
  const conversation = createDefaultStageConversation(deps, { project, feature, stage: nextStage, fromConversationIds });
  const updatedFeature = deps.store.updateFeature(feature.id, { status: "active" });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature: updatedFeature };
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
  const primarySnail = deps.snailRegistry.getPrimaryForStageType(input.stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.project.id,
    featureId: input.feature.id,
    stageId: input.stage.id,
    title: `${input.feature.title} · ${input.stage.type} #${input.stage.sequence}`,
    kind: "discussion",
    defaultSnail: primarySnail.name,
    participatingSnails: ["Boss Snail", ...deps.snailRegistry.listByStageType(input.stage.type).map((snail) => snail.name)],
    summary: `Auto-created conversation for feature ${input.feature.title} stage ${input.stage.type}`,
    fromConversationIds: input.fromConversationIds,
  });
}
