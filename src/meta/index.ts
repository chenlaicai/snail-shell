import fs from "fs";
import path from "path";
import type { ArtifactStorageType, ArtifactType } from "../shared/types";

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

export function loadArtifactDefinitions(): Record<ArtifactType, ArtifactDefinition> {
  const raw = fs.readFileSync(artifactsPath, "utf8");
  return JSON.parse(raw) as Record<ArtifactType, ArtifactDefinition>;
}
