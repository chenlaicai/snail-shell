import fs from "fs";
import path from "path";
import type { ArtifactStorageType, ArtifactType, SnailName, StageType } from "../shared/types";

export interface StageRoleDefinition {
  id: string;
  name: string;
  description: string;
  required_capabilities: string[];
  preferred_artifact_types: ArtifactType[];
  working_rules: string[];
}

export interface StageDefinition {
  order: number;
  title: string;
  repo_related?: boolean;
  formal_artifact_types: ArtifactType[];
  snails: SnailName[];
  roles: StageRoleDefinition[];
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

export { getPromptDocument, getTaskPrompt, listPromptDocuments, listPromptDocumentsForTarget, renderPromptContent, renderPromptTemplate } from "../prompt-center";
export type { PromptDocument, PromptMatchContext, PromptSkillReference } from "../prompt-center";
export { getPromptEvaluationSample, listPromptEvaluationSamples, summarizePromptEvaluationCoverage } from "../prompt-center";
export type { PromptEvaluationSample, PromptEvaluationRuntimeSummary, PromptEvaluationDimension } from "../prompt-center";
export { buildPromptEvaluationJudgePrompt, buildPromptEvaluationTargetPrompt, parsePromptEvaluationJudgement, runPromptEvaluations } from "../prompt-center";
export type { PromptEvaluationInvoker, PromptEvaluationJudgement, PromptEvaluationReport, PromptEvaluationResult, PromptEvaluationStatus } from "../prompt-center";
export { getSkill, listSkills } from "../skill-center";
export type { SkillDefinition } from "../skill-center";

export function loadStageDefinitions(): Record<StageType, StageDefinition> {
  const raw = fs.readFileSync(stagesPath, "utf8");
  return JSON.parse(raw) as Record<StageType, StageDefinition>;
}

export function loadArtifactDefinitions(): Record<ArtifactType, ArtifactDefinition> {
  const raw = fs.readFileSync(artifactsPath, "utf8");
  return JSON.parse(raw) as Record<ArtifactType, ArtifactDefinition>;
}
