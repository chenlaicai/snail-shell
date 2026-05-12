import fs from "fs";
import path from "path";
import type { ArtifactStorageType, ArtifactType, SnailName, StageType } from "../persistence/store";

export interface StageDefinition {
  order: number;
  title: string;
  repo_related?: boolean;
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

const stagesPath = path.join(process.cwd(), ".meta", "stages.json");
const artifactsPath = path.join(process.cwd(), ".meta", "artifacts.json");

export interface ArtifactDefinition {
  title: string;
  description: string;
  storage_type: ArtifactStorageType;
  formal: boolean;
}

export { getPromptDocument, getTaskPrompt, listPromptDocuments, listPromptDocumentsForTarget, renderPromptContent, renderPromptOutline, renderPromptTemplate } from "./prompt-registry";
export type { PromptDocument, PromptMatchContext, PromptSkillReference } from "./prompt-registry";
export { getPromptEvaluationSample, listPromptEvaluationSamples, summarizePromptEvaluationCoverage } from "./prompt-evaluation-registry";
export type { PromptEvaluationSample, PromptEvaluationRuntimeSummary, PromptEvaluationDimension } from "./prompt-evaluation-registry";
export { getSkill, listSkills } from "./skill-registry";
export type { SkillDefinition } from "./skill-registry";

export function loadStageDefinitions(): Record<StageType, StageDefinition> {
  const raw = fs.readFileSync(stagesPath, "utf8");
  return JSON.parse(raw) as Record<StageType, StageDefinition>;
}

export function loadArtifactDefinitions(): Record<ArtifactType, ArtifactDefinition> {
  const raw = fs.readFileSync(artifactsPath, "utf8");
  return JSON.parse(raw) as Record<ArtifactType, ArtifactDefinition>;
}
