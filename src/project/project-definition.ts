import { loadArtifactDefinitions } from "../meta";
import type { ArtifactDefinitionMap, StageDefinitionMap } from "../meta";
import type { Project, ProjectKind, SnailName, StageType } from "../persistence/store";
import type { SnailDefinitionMap, SnailRegistry } from "../snails";
import type { ProjectDetail, StageDetail } from "./manager-types";
import { resolveProjectWorkflow } from "./workflow-definition";

export interface CreateProjectOptions {
  name: string;
  summary?: string;
  kind?: ProjectKind;
  workflowStageTypes?: StageType[];
  workflowStageDefinitions?: StageDefinitionMap;
  artifactDefinitions?: ArtifactDefinitionMap;
  snailDefinitions?: SnailDefinitionMap;
}

export interface ResolvedProjectDefinitionInput {
  name: string;
  summary?: string;
  kind: ProjectKind;
  workflowStageTypes: StageType[];
  workflowStageDefinitions: StageDefinitionMap;
  artifactDefinitions: ArtifactDefinitionMap;
  snailDefinitions: SnailDefinitionMap;
}

export function buildSnailDefinitionMap(snailRegistry: SnailRegistry, snailDefinitions?: SnailDefinitionMap): SnailDefinitionMap {
  const registryMap = Object.fromEntries(snailRegistry.list().map((snail) => [snail.name, snail])) as SnailDefinitionMap;
  return snailDefinitions ? { ...registryMap, ...snailDefinitions } : registryMap;
}

export function resolveProjectDefinitionInput(
  snailRegistry: SnailRegistry,
  options: CreateProjectOptions
): ResolvedProjectDefinitionInput {
  const resolvedWorkflow = resolveProjectWorkflow(options.workflowStageTypes, options.workflowStageDefinitions);
  return {
    name: options.name,
    summary: options.summary,
    kind: options.kind ?? "product_delivery",
    workflowStageTypes: resolvedWorkflow.workflowStageTypes,
    workflowStageDefinitions: resolvedWorkflow.workflowStageDefinitions,
    artifactDefinitions: options.artifactDefinitions ?? loadArtifactDefinitions(),
    snailDefinitions: buildSnailDefinitionMap(snailRegistry, options.snailDefinitions),
  };
}

export function buildMentionParticipants(participatingSnails: SnailName[], snailDefinitions: SnailDefinitionMap) {
  return participatingSnails
    .map((snailName) => snailDefinitions[snailName])
    .filter((snail): snail is NonNullable<typeof snail> => Boolean(snail))
    .map((snail) => ({ name: snail.name }));
}

export function buildProjectSnailFallback(snailRegistry: SnailRegistry, projectName: string): SnailDefinitionMap {
  return resolveProjectDefinitionInput(snailRegistry, { name: projectName }).snailDefinitions;
}

export function resolveUpdatedProjectDefinitionInput(
  snailRegistry: SnailRegistry,
  project: Project,
  options: CreateProjectOptions
): ResolvedProjectDefinitionInput {
  return resolveProjectDefinitionInput(snailRegistry, {
    name: options.name ?? project.name,
    summary: options.summary ?? project.summary ?? undefined,
    kind: options.kind ?? project.kind,
    workflowStageTypes: options.workflowStageTypes ?? project.workflow_stage_types,
    workflowStageDefinitions: options.workflowStageDefinitions ?? project.workflow_stage_definitions,
    artifactDefinitions: options.artifactDefinitions ?? project.artifact_definitions,
    snailDefinitions: options.snailDefinitions ?? project.snail_definitions,
  });
}

export function buildProjectDetail(project: Project, stages: StageDetail[], conversationCount: number, bossPendingCount: number): ProjectDetail {
  return {
    ...project,
    stages,
    conversation_count: conversationCount,
    stage_count: stages.length,
    boss_pending_count: bossPendingCount,
  };
}
