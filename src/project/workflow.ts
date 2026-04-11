import { randomUUID } from "crypto";
import type { Conversation, ConversationStore, Project, ProjectKind, Stage } from "../persistence/store";
import { STAGE_TYPES } from "../persistence/store";
import type { SnailRegistry } from "../snails";

export interface StageAdvanceResult {
  completed_stage: Stage;
  next_stage: Stage;
  conversation: Conversation;
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
): { project: Project; stage: Stage; conversation: Conversation } {
  const project = deps.store.createProject(randomUUID(), kind, name, summary);
  const stage = deps.store.createStage({
    id: randomUUID(),
    projectId: project.id,
    type: STAGE_TYPES[0],
    sequence: 1,
    status: "in_progress",
    formalArtifacts: [],
    enteredAt: new Date().toISOString(),
  });
  const conversation = deps.store.createConversation({
    id: randomUUID(),
    projectId: project.id,
    stageId: stage.id,
    title: `${name} · ${stage.type}`,
    kind: "discussion",
    defaultSnail: deps.snailRegistry.getPrimaryForStageType(stage.type).title,
    participatingSnails: deps.snailRegistry.listByStageType(stage.type).map((snail) => snail.name),
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
  const stage = deps.store.getStage(input.stageId);
  if (!stage || stage.project_id !== input.projectId) {
    throw new Error(`Stage not found: ${input.stageId}`);
  }

  const primarySnail = deps.snailRegistry.getPrimaryForStageType(stage.type);
  return deps.store.createConversation({
    id: randomUUID(),
    projectId: input.projectId,
    stageId: input.stageId,
    title: input.title,
    kind: input.kind,
    defaultSnail: primarySnail.title,
    participatingSnails: deps.snailRegistry.listByStageType(stage.type).map((snail) => snail.name),
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
  const primarySnail = deps.snailRegistry.getPrimaryForStageType(nextStage.type);
  const conversation = deps.store.createConversation({
    id: randomUUID(),
    projectId: project.id,
    stageId: nextStage.id,
    title: `${project.name} · ${nextStage.type}`,
    kind: "discussion",
    defaultSnail: primarySnail.title,
    participatingSnails: deps.snailRegistry.listByStageType(nextStage.type).map((snail) => snail.name),
    summary: `Auto-created conversation for stage ${nextStage.type}`,
    fromConversationIds: deps.store.listConversationsByStage(activeStage.id).map((item) => item.id),
  });

  return {
    completed_stage: completedStage,
    next_stage: nextStage,
    conversation,
  };
}
