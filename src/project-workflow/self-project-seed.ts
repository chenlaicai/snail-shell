import type { Conversation, ConversationStore, Feature, Project, Stage } from "../persistence/store";
import { createInitialWorkflow } from "./workflow";
import type { SnailRegistry } from "../snails";

const PROJECT_NAME = "Snail Shell";
const PROJECT_KIND = "system_self";
const PROJECT_SUMMARY = "用于迭代 Snail Shell 自身的默认项目。";

export interface SeedSelfProjectResult {
  created: boolean;
  project: Project;
  feature: Feature | null;
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
    const feature = store.listFeatures(existingProject.id).find((item) => item.status === "active" || item.status === "in_review") ?? store.listFeatures(existingProject.id)[0] ?? null;
    const stage = feature ? store.getActiveStage(feature.id) ?? null : null;
    return {
      created: false,
      project: existingProject,
      feature,
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
  return { created: true, project: result.project, feature: result.feature, stage: result.stage, conversation: result.conversation };
}
