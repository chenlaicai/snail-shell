import type { Conversation, ConversationStore, Feature, Project, Stage } from "../persistence/store";
import { createFeatureWorkflow, createInitialWorkflow, type StageDefinitionInput } from "./workflow";
import type { RoleRegistry } from "../roles";

const PROJECT_NAME = "Snail Shell";
const PROJECT_KIND = "system_self";
const PROJECT_MODULE = "project_management";
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

export function seedSelfProject(store: ConversationStore, roleRegistry: RoleRegistry, stageDefinitions?: StageDefinitionInput[]): SeedSelfProjectResult {
  const existingProject = store.findProjectByNameAndKind(PROJECT_NAME, PROJECT_KIND);
  if (existingProject) {
    const features = store.listFeatures(existingProject.id);
    // 优先取有进行中 stage 的 feature，兜底取第一个
    let feature = features.find((item) => {
      const activeStage = store.getActiveStage(item.id);
      return activeStage !== undefined;
    }) ?? features[0] ?? null;
    let stage = feature ? store.getActiveStage(feature.id) ?? null : null;
    let conversation = getDefaultConversation(store, stage);
    // Project exists (e.g. from seedProjectConfig) but has no feature/stage yet — create them
    if (!feature && stageDefinitions?.length) {
      const created = createFeatureWorkflow({ store, roleRegistry }, { project: existingProject, title: "初始研发迭代", summary: "项目创建时自动生成的默认 feature。" });
      feature = created.feature;
      stage = created.stage;
      conversation = created.conversation;
    }
    return { created: false, project: existingProject, feature, stage, conversation };
  }

  const result = createInitialWorkflow(
    { store, roleRegistry },
    { name: PROJECT_NAME, summary: PROJECT_SUMMARY, kind: PROJECT_KIND, module: PROJECT_MODULE, stageDefinitions },
  );
  return { created: true, project: result.project, feature: result.feature, stage: result.stage, conversation: result.conversation };
}
