import { randomUUID } from "crypto";
import type { Artifact, Conversation, ConversationStore, Feature, Project, ProjectKind, SnailName, Stage, StageType } from "../persistence/store";
import type { SnailDefinition, SnailRegistry } from "../snails";

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

export function createInitialWorkflow(
  deps: WorkflowDependencies,
  name: string,
  summary: string | undefined,
  kind: ProjectKind
): { project: Project; feature: Feature; stage: Stage; conversation: Conversation } {
  const project = deps.store.createProject(randomUUID(), kind, name, summary);
  seedProjectSnailAssignments(deps, project);
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
  const stage = createFeatureStage(deps, { project: input.project, feature, type: "development", sequence: 1 });
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

  ensureProjectSnailAssignments(deps, input.projectId);
  const primarySnail = getPrimarySnailForProjectStage(deps, input.projectId, stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.projectId,
    featureId: input.featureId,
    stageId: input.stageId,
    title: input.title,
    kind: input.kind,
    defaultSnail: primarySnail.name,
    participatingSnails: participatingSnailNamesForProjectStage(deps, input.projectId, stage.type),
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
  const nextStage = createFeatureStage(deps, { project, feature, type: "review", sequence: activeStage.sequence + 1 });
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
  const nextStage = createFeatureStage(deps, { project, feature, type: "development", sequence: activeStage.sequence + 1 });
  const conversation = createDefaultStageConversation(deps, { project, feature, stage: nextStage, fromConversationIds });
  const updatedFeature = deps.store.updateFeature(feature.id, { status: "active" });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, feature: updatedFeature };
}

function createFeatureStage(
  deps: WorkflowDependencies,
  input: { project: Project; feature: Feature; type: Stage["type"]; sequence: number }
): Stage {
  return deps.store.createStage({
    id: randomUUID(),
    projectId: input.project.id,
    featureId: input.feature.id,
    type: input.type,
    sequence: input.sequence,
    status: "in_progress",
    formalArtifacts: [],
    enteredAt: new Date().toISOString(),
  });
}

function createDefaultStageConversation(
  deps: WorkflowDependencies,
  input: { project: Project; feature: Feature; stage: Stage; fromConversationIds: string[] }
): Conversation {
  ensureProjectSnailAssignments(deps, input.project.id);
  const primarySnail = getPrimarySnailForProjectStage(deps, input.project.id, input.stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.project.id,
    featureId: input.feature.id,
    stageId: input.stage.id,
    title: `${input.feature.title} · ${input.stage.type} #${input.stage.sequence}`,
    kind: "discussion",
    defaultSnail: primarySnail.name,
    participatingSnails: participatingSnailNamesForProjectStage(deps, input.project.id, input.stage.type),
    summary: `Auto-created conversation for feature ${input.feature.title} stage ${input.stage.type}`,
    fromConversationIds: input.fromConversationIds,
  });
}

function ensureProjectSnailAssignments(deps: WorkflowDependencies, projectId: string): void {
  if (deps.store.listProjectSnailAssignments(projectId).length > 0) return;
  const project = deps.store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  seedProjectSnailAssignments(deps, project);
}

function seedProjectSnailAssignments(deps: WorkflowDependencies, project: Project): void {
  for (const snail of deps.snailRegistry.list()) {
    deps.store.upsertSnail({
      id: snail.id,
      name: snail.name,
      kind: snail.kind ?? "agent",
      runtime: snail.runtime ?? null,
      profile: snail.description,
      capabilityExpectations: snail.capability_expectations,
      workingRules: snail.working_rules,
      preferredArtifactTypes: snail.preferred_artifact_types,
      systemPromptAsset: snail.system_prompt.asset_id,
    });
  }

  /**
   * 当前 Snail Shell 仍按固定两阶段、两只 agent 的流程运行。assignment 在项目创建时落库，
   * 是为了让“这只 snail 是谁”和“它在本项目承担什么职责”从一开始就有完整数据链路；
   * 后续即使开放项目配置，也只是替换这里的 seed 来源，不需要再改 conversation/message 流程。
   */
  for (const stageType of ["development", "review"] as StageType[]) {
    for (const snail of deps.snailRegistry.listByStageType(stageType)) {
      deps.store.upsertProjectSnailAssignment({
        id: `${project.id}:${snail.id}:${stageType}`,
        projectId: project.id,
        snailId: snail.id,
        roleKey: stageTypeRoleKey(stageType, snail.name),
        roleTitle: snail.name,
        roleDescription: snail.description,
        stageTypes: [stageType],
        workingRules: snail.working_rules,
        preferredArtifactTypes: snail.preferred_artifact_types,
      });
    }
  }
}

function getPrimarySnailForProjectStage(deps: WorkflowDependencies, projectId: string, stageType: StageType): SnailDefinition {
  const assignment = deps.store.listProjectSnailAssignmentsForStage(projectId, stageType)[0];
  const snail = assignment ? deps.snailRegistry.getById(assignment.snail_id) : deps.snailRegistry.getPrimaryForStageType(stageType);
  if (!snail) throw new Error(`No snail configured for project ${projectId} stage ${stageType}`);
  return snail;
}

function participatingSnailNamesForProjectStage(deps: WorkflowDependencies, projectId: string, stageType: StageType): SnailName[] {
  const names = deps.store.listProjectSnailAssignmentsForStage(projectId, stageType)
    .map((assignment) => deps.snailRegistry.getById(assignment.snail_id)?.name)
    .filter((name): name is SnailName => Boolean(name));
  const fallback = deps.snailRegistry.listByStageType(stageType).map((snail) => snail.name);
  return Array.from(new Set<SnailName>(["Boss Snail", ...(names.length ? names : fallback)]));
}

function stageTypeRoleKey(stageType: StageType, snailName: SnailName): string {
  if (stageType === "development" && snailName === "Implementation Snail") return "implementation";
  if (stageType === "review" && snailName === "Acceptance Snail") return "acceptance";
  return `${stageType}:${snailName}`;
}

export function getStageInputArtifacts(store: ConversationStore, stage: Stage): Artifact[] {
  const previousStage = store.listStagesByFeature(stage.feature_id)
    .filter((item) => item.sequence < stage.sequence)
    .sort((left, right) => right.sequence - left.sequence)[0];
  if (!previousStage?.formal_artifacts.length) {
    return [];
  }

  const previousArtifacts = store.listArtifactsByStage(previousStage.id);
  return previousStage.formal_artifacts
    .map((artifactId) => previousArtifacts.find((artifact) => artifact.id === artifactId))
    .filter((artifact): artifact is Artifact => Boolean(artifact));
}
