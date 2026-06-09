import fs from "fs";
import path from "path";
import type { AgentRuntime } from "../shared/types";

export type PromptEvaluationDimension =
  | "action-restraint"
  | "scope-boundary"
  | "continuous-execution"
  | "message-protocol"
  | "runtime-differentiation";

export interface PromptEvaluationScenario {
  workspace_kind: string;
  stage: string;
  user_request: string;
}

export interface PromptEvaluationSample {
  id: string;
  title: string;
  dimension: PromptEvaluationDimension;
  risk: string;
  source: string;
  agent_runtimes: AgentRuntime[];
  scenario: PromptEvaluationScenario;
  expected_behaviors: string[];
  forbidden_behaviors: string[];
}

export interface PromptEvaluationRuntimeSummary {
  runtime: AgentRuntime;
  sampleCount: number;
  sampleIds: string[];
}

const promptEvaluationPath = path.join(process.cwd(), ".meta", "prompt-evaluations", "prompt-behavior-samples.json");
const supportedRuntimes: AgentRuntime[] = ["opencode-cli", "claude-code-cli", "codex-cli"];
const promptEvaluationSamples = loadPromptEvaluationSamples();

export function listPromptEvaluationSamples(): PromptEvaluationSample[] {
  return promptEvaluationSamples;
}

export function getPromptEvaluationSample(id: string): PromptEvaluationSample {
  const sample = promptEvaluationSamples.find((item) => item.id === id);
  if (!sample) {
    throw new Error(`Prompt evaluation sample not found: ${id}`);
  }
  return sample;
}

export function summarizePromptEvaluationCoverage(): PromptEvaluationRuntimeSummary[] {
  return supportedRuntimes.map((runtime) => {
    const samples = promptEvaluationSamples.filter((item) => item.agent_runtimes.includes(runtime));
    return {
      runtime,
      sampleCount: samples.length,
      sampleIds: samples.map((item) => item.id),
    };
  });
}

function loadPromptEvaluationSamples(): PromptEvaluationSample[] {
  if (!fs.existsSync(promptEvaluationPath)) {
    return [];
  }
  const raw = fs.readFileSync(promptEvaluationPath, "utf8");
  const parsed = JSON.parse(raw) as PromptEvaluationSample[];
  validatePromptEvaluationSamples(parsed);
  return parsed;
}

function validatePromptEvaluationSamples(samples: PromptEvaluationSample[]): void {
  const seen = new Map<string, PromptEvaluationSample>();
  for (const sample of samples) {
    const existing = seen.get(sample.id);
    if (existing) {
      throw new Error(`Duplicate prompt evaluation sample id: ${sample.id}`);
    }
    seen.set(sample.id, sample);
    validatePromptEvaluationSample(sample);
  }
}

function validatePromptEvaluationSample(sample: PromptEvaluationSample): void {
  assertNonEmpty(sample.id, "sample.id");
  assertNonEmpty(sample.title, `sample.title (${sample.id})`);
  assertNonEmpty(sample.risk, `sample.risk (${sample.id})`);
  assertNonEmpty(sample.source, `sample.source (${sample.id})`);
  assertNonEmpty(sample.scenario?.workspace_kind, `sample.scenario.workspace_kind (${sample.id})`);
  assertNonEmpty(sample.scenario?.stage, `sample.scenario.stage (${sample.id})`);
  assertNonEmpty(sample.scenario?.user_request, `sample.scenario.user_request (${sample.id})`);
  assertStringArray(sample.expected_behaviors, `sample.expected_behaviors (${sample.id})`);
  assertStringArray(sample.forbidden_behaviors, `sample.forbidden_behaviors (${sample.id})`);
  if (sample.expected_behaviors.length === 0) {
    throw new Error(`Prompt evaluation sample must include at least one expected behavior: ${sample.id}`);
  }
  if (sample.forbidden_behaviors.length === 0) {
    throw new Error(`Prompt evaluation sample must include at least one forbidden behavior: ${sample.id}`);
  }
  if (!Array.isArray(sample.agent_runtimes) || sample.agent_runtimes.length === 0) {
    throw new Error(`Prompt evaluation sample must include agent runtimes: ${sample.id}`);
  }
  for (const runtime of sample.agent_runtimes) {
    if (!supportedRuntimes.includes(runtime)) {
      throw new Error(`Unsupported prompt evaluation runtime ${String(runtime)} in sample: ${sample.id}`);
    }
  }
}

function assertNonEmpty(value: string | undefined, label: string): void {
  if (!value || !value.trim()) {
    throw new Error(`Prompt evaluation sample field must be non-empty: ${label}`);
  }
}

function assertStringArray(values: string[] | undefined, label: string): void {
  if (!Array.isArray(values)) {
    throw new Error(`Prompt evaluation sample field must be an array: ${label}`);
  }
  for (const value of values) {
    if (!value.trim()) {
      throw new Error(`Prompt evaluation sample field must not contain empty strings: ${label}`);
    }
  }
}
