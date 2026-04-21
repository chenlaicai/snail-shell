import type { Project } from "../persistence/store";
import type { SnailDefinitionMap } from "../snails";

export function getProjectSnailDefinitions(project: Project | null | undefined, fallback: SnailDefinitionMap): SnailDefinitionMap {
  if (project?.snail_definitions && Object.keys(project.snail_definitions).length > 0) {
    return project.snail_definitions;
  }
  return fallback;
}
