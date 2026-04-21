import type { StageDefinitionMap } from "../meta";
import type { Project, StageType } from "../persistence/store";
import { STAGE_DEFINITIONS, STAGE_TYPES } from "../persistence/store";

export function getProjectStageDefinition(project: Project, stageType: StageType) {
  return project.workflow_stage_definitions[stageType] ?? STAGE_DEFINITIONS[stageType];
}

export function getProjectRequiredArtifactTypes(project: Project, stageType: StageType) {
  return getProjectStageDefinition(project, stageType)?.formal_artifact_types ?? [];
}

export function getProjectNextStageType(project: Project, sequence: number): StageType | null {
  return project.workflow_stage_types[sequence] ?? null;
}

export function resolveProjectWorkflow(
  workflowStageTypes?: StageType[],
  workflowStageDefinitions?: StageDefinitionMap
): { workflowStageTypes: StageType[]; workflowStageDefinitions: StageDefinitionMap } {
  const candidate = workflowStageTypes?.length ? workflowStageTypes : STAGE_TYPES;
  const baseDefinitions = workflowStageDefinitions ?? STAGE_DEFINITIONS;
  const invalidTypes = candidate.filter((stageType) => !Object.prototype.hasOwnProperty.call(baseDefinitions, stageType));
  if (invalidTypes.length > 0) {
    throw new Error(`Invalid workflow stage types: ${invalidTypes.join(", ")}`);
  }
  if (candidate.length === 0) {
    throw new Error("workflow_stage_types must contain at least one stage");
  }
  const resolvedDefinitions = Object.fromEntries(candidate.map((stageType, index) => {
    const definition = baseDefinitions[stageType];
    if (!definition) {
      throw new Error(`Missing workflow stage definition: ${stageType}`);
    }
    if (!Array.isArray(definition.snails) || definition.snails.length === 0) {
      throw new Error(`Stage '${stageType}' must define at least one snail`);
    }
    return [stageType, {
      ...definition,
      order: index + 1,
    }];
  })) as StageDefinitionMap;
  return {
    workflowStageTypes: [...candidate],
    workflowStageDefinitions: resolvedDefinitions,
  };
}
