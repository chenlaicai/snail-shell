import type { Conversation, ConversationStore, Project, Stage } from "../persistence/store";
import { createInitialWorkflow } from "./workflow";
import type { SnailRegistry } from "../snails";

const PROJECT_NAME = "Snail Shell";
const PROJECT_KIND = "system_self";
const PROJECT_SUMMARY = "用于迭代 Snail Shell 自身的默认项目。";

export interface SeedSelfProjectResult {
  created: boolean;
  project: Project;
  stage: Stage | null;
  conversation: Conversation | null;
}

function getDefaultConversation(store: ConversationStore, stage: Stage | null): Conversation | null {
  if (!stage) return null;
  return store.getInitialConversationByStage(stage.id) ?? null;
}

export function seedSelfProject(store: ConversationStore, snailRegistry: SnailRegistry): SeedSelfProjectResult {
  const existingProject = store.findProjectByNameAndKind(PROJECT_NAME, PROJECT_KIND);
  if (existingProject) {
    const stage = store.getActiveStage(existingProject.id) ?? null;
    return {
      created: false,
      project: existingProject,
      stage,
      conversation: getDefaultConversation(store, stage),
    };
  }

  const result = createInitialWorkflow(
    { store, snailRegistry },
    PROJECT_NAME,
    PROJECT_SUMMARY,
    PROJECT_KIND
  );
  return { created: true, project: result.project, stage: result.stage, conversation: result.conversation };
}
