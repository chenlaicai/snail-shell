import type { Conversation, ConversationStore, Feature, Workspace, Stage } from "../persistence/store";
import { createFeatureWorkflow } from "./workflow";
import type { RoleRegistry } from "../roles";

const WORKSPACE_NAME = "Snail Shell";

export interface SeedSelfWorkspaceResult {
  created: boolean;
  workspace: Workspace;
  feature: Feature | null;
  stage: Stage | null;
  conversation: Conversation | null;
}

function getDefaultConversation(store: ConversationStore, stage: Stage | null): Conversation | null {
  if (!stage) return null;
  return store.getInitialConversationByStage(stage.id) ?? null;
}

export function seedSelfWorkspace(store: ConversationStore, roleRegistry: RoleRegistry): SeedSelfWorkspaceResult {
  const existingWorkspace = store.findWorkspaceByName(WORKSPACE_NAME);
  if (!existingWorkspace) {
    throw new Error(`Self workspace "${WORKSPACE_NAME}" not found. Ensure workspace-config-seed.json defines it and seedWorkspaceConfigs runs first.`);
  }
  const features = store.listFeatures(existingWorkspace.id);
  let feature = features.find((item) => {
    const activeStage = store.getActiveStage(item.id);
    return activeStage !== undefined;
  }) ?? features[0] ?? null;
  let stage = feature ? store.getActiveStage(feature.id) ?? null : null;
  let conversation = getDefaultConversation(store, stage);
  if (!feature) {
    const created = createFeatureWorkflow({ store, roleRegistry }, { workspace: existingWorkspace, title: "初始设计与实现", summary: "工作区创建时自动生成的默认 feature。" });
    feature = created.feature;
    stage = created.stage;
    conversation = created.conversation;
  }
  return { created: false, workspace: existingWorkspace, feature, stage, conversation };
}
