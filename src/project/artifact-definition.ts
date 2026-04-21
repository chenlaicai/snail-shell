import { loadArtifactDefinitions } from "../meta";
import type { ArtifactDefinitionMap } from "../meta";
import type { Project } from "../persistence/store";

export function getProjectArtifactDefinitions(project: Project | null | undefined): ArtifactDefinitionMap {
  if (project?.artifact_definitions && Object.keys(project.artifact_definitions).length > 0) {
    return project.artifact_definitions;
  }
  return loadArtifactDefinitions();
}
