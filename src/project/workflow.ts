import { randomUUID } from "crypto";
import type { ArtifactDefinitionMap, StageDefinitionMap } from "../meta";
import type { Conversation, ConversationStore, Project, ProjectKind, SnailName, Stage } from "../persistence/store";
import type { SnailDefinitionMap, SnailRegistry } from "../snails";
import { getProjectSnailDefinitions } from "./snail-definition";

export interface StageAdvanceResult {
  completed_stage: Stage;
  next_stage: Stage;
  conversation: Conversation;
}

interface WorkflowDependencies {
  store: ConversationStore;
  snailRegistry: SnailRegistry;
}

interface InitialWorkflowInput {
  name: string;
  summary?: string;
  kind: ProjectKind;
  workflowStageTypes: Stage["type"][];
  workflowStageDefinitions: StageDefinitionMap;
  artifactDefinitions: ArtifactDefinitionMap;
  snailDefinitions: SnailDefinitionMap;
}

function buildStageParticipants(
  snailRegistry: SnailRegistry,
  snailDefinitions: SnailDefinitionMap,
  workflowStageDefinitions: StageDefinitionMap,
  stageType: Stage["type"]
): { defaultSnail: Conversation["default_snail"]; participatingSnails: Conversation["participating_snails"] } {
  const stageDefinition = workflowStageDefinitions[stageType];
  if (!stageDefinition || !stageDefinition.snails.length) {
    throw new Error(`No snails configured for stage type: ${stageType}`);
  }
  const participatingSnails = ["Boss Snail", ...stageDefinition.snails].filter(
    (snailName, index, arr) => arr.indexOf(snailName) === index
  ) as SnailName[];
  const defaultSnail = stageDefinition.snails[0];
  if (!snailDefinitions[defaultSnail] && !snailRegistry.get(defaultSnail)) {
    throw new Error(`Default snail not found: ${defaultSnail}`);
  }
  return { defaultSnail, participatingSnails };
}

export function createInitialWorkflow(
  deps: WorkflowDependencies,
  input: InitialWorkflowInput
): { project: Project; stage: Stage; conversation: Conversation } {
  const project = deps.store.createProject({
    id: randomUUID(),
    kind: input.kind,
    name: input.name,
    workflowStageTypes: input.workflowStageTypes,
    workflowStageDefinitions: input.workflowStageDefinitions,
    artifactDefinitions: input.artifactDefinitions,
    snailDefinitions: input.snailDefinitions,
    summary: input.summary,
  });
  const stage = deps.store.createStage({
    id: randomUUID(),
    projectId: project.id,
    type: input.workflowStageTypes[0],
    sequence: 1,
    status: "in_progress",
    formalArtifacts: [],
    enteredAt: new Date().toISOString(),
  });
  const stageParticipants = buildStageParticipants(deps.snailRegistry, getProjectSnailDefinitions(project, {}), project.workflow_stage_definitions, stage.type);
  const conversation = deps.store.createConversation({
    id: randomUUID(),
    projectId: project.id,
    stageId: stage.id,
    title: `${input.name} · ${stage.type}`,
    kind: "discussion",
    defaultSnail: stageParticipants.defaultSnail,
    participatingSnails: stageParticipants.participatingSnails,
  });

  return { project, stage, conversation };
}

export function createStageConversation(
  deps: WorkflowDependencies,
  input: {
    projectId: string;
    stageId: string;
    title: string;
    kind: Conversation["kind"];
    fromConversationIds?: string[];
    summary?: string;
  }
): Conversation {
  const project = deps.store.getProject(input.projectId);
  const stage = deps.store.getStage(input.stageId);
  if (!project || !stage || stage.project_id !== input.projectId) {
    throw new Error(`Stage not found: ${input.stageId}`);
  }

  const stageParticipants = buildStageParticipants(deps.snailRegistry, getProjectSnailDefinitions(project, {}), project.workflow_stage_definitions, stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.projectId,
    stageId: input.stageId,
    title: input.title,
    kind: input.kind,
    defaultSnail: stageParticipants.defaultSnail,
    participatingSnails: stageParticipants.participatingSnails,
    summary: input.summary,
    fromConversationIds: input.fromConversationIds,
  });
}

export function advanceStageWorkflow(
  deps: WorkflowDependencies,
  project: Project,
  activeStage: Stage,
  nextStageType: Stage["type"]
): StageAdvanceResult {
  const completedStage = deps.store.updateStage(activeStage.id, {
    status: "completed",
    left_at: new Date().toISOString(),
  });
  const nextStage = deps.store.createStage({
    id: randomUUID(),
    projectId: project.id,
    type: nextStageType,
    sequence: deps.store.listStages(project.id).length + 1,
    status: "in_progress",
    formalArtifacts: [],
    enteredAt: new Date().toISOString(),
  });
  const stageParticipants = buildStageParticipants(deps.snailRegistry, getProjectSnailDefinitions(project, {}), project.workflow_stage_definitions, nextStage.type);
  const conversation = deps.store.createConversation({
    id: randomUUID(),
    projectId: project.id,
    stageId: nextStage.id,
    title: `${project.name} · ${nextStage.type}`,
    kind: "discussion",
    defaultSnail: stageParticipants.defaultSnail,
    participatingSnails: stageParticipants.participatingSnails,
    summary: `Auto-created conversation for stage ${nextStage.type}`,
    fromConversationIds: deps.store.listConversationsByStage(activeStage.id).map((item) => item.id),
  });

  return {
    completed_stage: completedStage,
    next_stage: nextStage,
    conversation,
  };
}
