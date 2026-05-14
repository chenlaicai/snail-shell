import { randomUUID } from "crypto";
import type { Artifact, Conversation, ConversationStore, Feature, Project, ProjectKind, RoleAssignment, Stage } from "../persistence/store";
import type { SnailName } from "../shared/types";
import type { SnailRegistry } from "../snails";
import { loadStageDefinitions } from "../meta";

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
    roleId?: string;
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
    roleId: input.roleId,
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
  const stageDefinitions = loadStageDefinitions();
  const stageDefinition = stageDefinitions[input.type];
  const roleAssignments: RoleAssignment[] = [];

  if (stageDefinition?.roles) {
    for (const role of stageDefinition.roles) {
      const matchingSnails = findMatchingSnails(deps.snailRegistry, role.required_capabilities);
      roleAssignments.push({
        role_id: role.id,
        assigned_snails: matchingSnails,
      });
    }
  }

  return deps.store.createStage({
    id: randomUUID(),
    projectId: input.project.id,
    featureId: input.feature.id,
    type: input.type,
    sequence: input.sequence,
    status: "in_progress",
    formalArtifacts: [],
    roleAssignments,
    enteredAt: new Date().toISOString(),
  });
}

function findMatchingSnails(snailRegistry: SnailRegistry, requiredCapabilities: string[]): SnailName[] {
  const allSnails = snailRegistry.list();
  const matchingSnails: SnailName[] = [];

  for (const snail of allSnails) {
    if (snail.kind === "human") continue;
    const hasCapabilities = requiredCapabilities.every((cap) =>
      snail.capability_expectations.some((expectation) => expectation.includes(cap) || cap.includes(expectation))
    );
    if (hasCapabilities) {
      matchingSnails.push(snail.name);
    }
  }

  return matchingSnails;
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
