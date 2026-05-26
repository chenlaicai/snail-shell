import type { Conversation, ConversationStore, Feature, Project, Stage } from "../persistence/store";
import { createFeatureWorkflow } from "./workflow";
import type { RoleRegistry } from "../roles";

const PROJECT_NAME = "Snail Shell";

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

export function seedSelfProject(store: ConversationStore, roleRegistry: RoleRegistry): SeedSelfProjectResult {
  const existingProject = store.findProjectByName(PROJECT_NAME);
  if (!existingProject) {
    throw new Error(`Self project "${PROJECT_NAME}" not found. Ensure project-config-seed.json defines it and seedProjectConfigs runs first.`);
  }
  const features = store.listFeatures(existingProject.id);
  let feature = features.find((item) => {
    const activeStage = store.getActiveStage(item.id);
    return activeStage !== undefined;
  }) ?? features[0] ?? null;
  let stage = feature ? store.getActiveStage(feature.id) ?? null : null;
  let conversation = getDefaultConversation(store, stage);
  if (!feature) {
    const created = createFeatureWorkflow({ store, roleRegistry }, { project: existingProject, title: "初始研发迭代", summary: "项目创建时自动生成的默认 feature。" });
    feature = created.feature;
    stage = created.stage;
    conversation = created.conversation;
  }
  return { created: false, project: existingProject, feature, stage, conversation };
}
