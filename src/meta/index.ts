import fs from "fs";
import path from "path";
import type { SnailName } from "../shared/types";

export interface SnailRawDefinition {
  description: string;
  runtime: string;
  kind?: "human" | "agent";
  template?: string;
  capability_expectations: string[];
  working_rules: string[];
  preferred_artifact_types: string[];
}

const snailsPath = path.join(process.cwd(), ".meta", "snails.json");

export function loadSnailDefinitions(): Record<SnailName, SnailRawDefinition> {
  const raw = fs.readFileSync(snailsPath, "utf8");
  return JSON.parse(raw) as Record<SnailName, SnailRawDefinition>;
}

export { listFrames, getFrame, getPrompt, listPrompts, renderPromptContent, renderPromptTemplate, renderFrame, buildFromFrame } from "../prompt-center";
export type { FrameDocument, FrameMatchContext, PromptDocument, PromptSkillReference } from "../prompt-center";
export { getPromptEvaluationSample, listPromptEvaluationSamples, summarizePromptEvaluationCoverage } from "../prompt-center";
export type { PromptEvaluationSample, PromptEvaluationRuntimeSummary, PromptEvaluationDimension } from "../prompt-center";
export { buildPromptEvaluationJudgePrompt, buildPromptEvaluationTargetPrompt, parsePromptEvaluationJudgement, runPromptEvaluations } from "../prompt-center";
export type { PromptEvaluationInvoker, PromptEvaluationJudgement, PromptEvaluationReport, PromptEvaluationResult, PromptEvaluationStatus } from "../prompt-center";
export { getSkill, listSkills } from "../skill-center";
export type { SkillDefinition } from "../skill-center";
