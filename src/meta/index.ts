import fs from "fs";
import path from "path";
import type { ArtifactStorageType, ArtifactType, SnailName } from "../persistence/store";

export interface StageDefinition {
  order: number;
  title: string;
  formal_artifact_types: ArtifactType[];
  snails: SnailName[];
  input: ArtifactType[];
  output: {
    summary: string;
    required_artifacts: ArtifactType[];
    artifact_requirements: string[];
  };
  acceptance_focus: string[];
}

export type StageDefinitionMap = Record<string, StageDefinition>;

const stagesPath = path.join(process.cwd(), ".meta", "stages.json");
const artifactsPath = path.join(process.cwd(), ".meta", "artifacts.json");
const projectTemplatesPath = path.join(process.cwd(), ".meta", "project-templates.json");

export interface ArtifactDefinition {
  title: string;
  description: string;
  storage_type: ArtifactStorageType;
  formal: boolean;
}

export type ArtifactDefinitionMap = Record<string, ArtifactDefinition>;

export interface ProjectTemplateDefinition {
  title: string;
  description: string;
  kind: string;
  workflow_stage_types: string[];
  workflow_stage_definitions: StageDefinitionMap;
  artifact_definitions: ArtifactDefinitionMap;
  snail_definitions: Record<string, unknown>;
}

export type ProjectTemplateMap = Record<string, ProjectTemplateDefinition>;

export function loadStageDefinitions(): StageDefinitionMap {
  const raw = fs.readFileSync(stagesPath, "utf8");
  return JSON.parse(raw) as StageDefinitionMap;
}

export function loadArtifactDefinitions(): ArtifactDefinitionMap {
  const raw = fs.readFileSync(artifactsPath, "utf8");
  return JSON.parse(raw) as ArtifactDefinitionMap;
}

export function loadProjectTemplates(): ProjectTemplateMap {
  if (!fs.existsSync(projectTemplatesPath)) {
    return {};
  }
  const raw = fs.readFileSync(projectTemplatesPath, "utf8");
  return JSON.parse(raw) as ProjectTemplateMap;
}

export function saveProjectTemplate(templateKey: string, template: ProjectTemplateDefinition): ProjectTemplateMap {
  const current = loadProjectTemplates();
  current[templateKey] = template;
  fs.writeFileSync(projectTemplatesPath, JSON.stringify(current, null, 2) + "\n", "utf8");
  return current;
}

export function deleteProjectTemplate(templateKey: string): ProjectTemplateMap {
  const current = loadProjectTemplates();
  delete current[templateKey];
  fs.writeFileSync(projectTemplatesPath, JSON.stringify(current, null, 2) + "\n", "utf8");
  return current;
}

export function getProjectTemplate(templateKey: string): ProjectTemplateDefinition | null {
  const current = loadProjectTemplates();
  return current[templateKey] ?? null;
}
