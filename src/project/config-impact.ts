import type { ConversationStore, Project } from "../persistence/store";

export interface ProjectConfigImpactSnapshot {
  used_stage_types: string[];
  used_artifact_types: string[];
  used_snail_names: string[];
}

export function collectProjectConfigImpact(store: ConversationStore, project: Project): ProjectConfigImpactSnapshot {
  const stages = store.listStages(project.id);
  const stageTypes = [...new Set(stages.map((stage) => stage.type))].sort();
  const conversations = store.listConversationsByProject(project.id);
  const snailNames = [...new Set(conversations.flatMap((conversation) => [conversation.default_snail, ...conversation.participating_snails]))].sort();
  const artifactTypes = [...new Set(stages.flatMap((stage) => store.listArtifactsByStage(stage.id).map((artifact) => artifact.artifact_type)))].sort();
  return {
    used_stage_types: stageTypes,
    used_artifact_types: artifactTypes,
    used_snail_names: snailNames,
  };
}
