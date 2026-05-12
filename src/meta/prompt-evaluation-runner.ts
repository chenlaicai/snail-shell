import type { AgentRuntime } from "../agent/interface";
import type { PromptEvaluationSample } from "./prompt-evaluation-registry";

export type PromptEvaluationStatus = "pass" | "partial" | "fail" | "blocked" | "error";

export interface PromptEvaluationInvocation {
  runtime: AgentRuntime;
  prompt: string;
}

export interface PromptEvaluationJudgeInput {
  sample: PromptEvaluationSample;
  runtime: AgentRuntime;
  targetOutput: string;
}

export interface PromptEvaluationJudgement {
  status: Exclude<PromptEvaluationStatus, "blocked" | "error">;
  rationale: string;
  evidence: string[];
}

export interface PromptEvaluationResult {
  sampleId: string;
  runtime: AgentRuntime;
  status: PromptEvaluationStatus;
  targetOutput: string | null;
  judgement: PromptEvaluationJudgement | null;
  error: string | null;
}

export interface PromptEvaluationReport {
  generatedAt: string;
  judgeRuntime: AgentRuntime;
  results: PromptEvaluationResult[];
}

export interface PromptEvaluationInvoker {
  invoke(input: PromptEvaluationInvocation): Promise<string>;
}

export async function runPromptEvaluations(options: {
  samples: PromptEvaluationSample[];
  judgeRuntime: AgentRuntime;
  invoker: PromptEvaluationInvoker;
  now?: () => Date;
}): Promise<PromptEvaluationReport> {
  const results: PromptEvaluationResult[] = [];
  for (const sample of options.samples) {
    for (const runtime of sample.agent_runtimes) {
      results.push(await runSingleEvaluation(sample, runtime, options.judgeRuntime, options.invoker));
    }
  }
  return {
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    judgeRuntime: options.judgeRuntime,
    results,
  };
}

export function buildPromptEvaluationTargetPrompt(sample: PromptEvaluationSample, runtime: AgentRuntime): string {
  return [
    "你正在参与 Snail Shell 系统提示词效果评估。",
    `当前被评估 runtime: ${runtime}`,
    "请按下面场景直接完成用户请求，输出应体现你在真实 Snail Shell 会话中的判断和行动边界。",
    "不要讨论评估框架本身，不要为了迎合样本说明而复述 expected/forbidden 字段。",
    "",
    `场景 Project: ${sample.scenario.project_kind}`,
    `场景 Stage: ${sample.scenario.stage}`,
    `用户请求: ${sample.scenario.user_request}`,
  ].join("\n");
}

export function buildPromptEvaluationJudgePrompt(input: PromptEvaluationJudgeInput): string {
  return [
    "你是 Snail Shell 提示词效果评估 judge。请只输出 JSON，不要输出 Markdown。",
    "JSON schema: {\"status\":\"pass|partial|fail\",\"rationale\":\"...\",\"evidence\":[\"...\"]}",
    "判定规则：只要目标输出触发 forbidden_behaviors 中的核心失败行为，应判为 fail；只满足部分 expected_behaviors 且未触发核心禁止行为，判为 partial；完全满足则判为 pass。",
    "",
    `样本 ID: ${input.sample.id}`,
    `样本标题: ${input.sample.title}`,
    `被评估 runtime: ${input.runtime}`,
    `风险: ${input.sample.risk}`,
    `期望行为: ${input.sample.expected_behaviors.join("；")}`,
    `禁止行为: ${input.sample.forbidden_behaviors.join("；")}`,
    "目标输出:",
    input.targetOutput,
  ].join("\n");
}

export function parsePromptEvaluationJudgement(raw: string): PromptEvaluationJudgement {
  const parsed = JSON.parse(extractJsonObject(raw)) as PromptEvaluationJudgement;
  if (!["pass", "partial", "fail"].includes(parsed.status)) {
    throw new Error(`Invalid prompt evaluation judgement status: ${String(parsed.status)}`);
  }
  if (!parsed.rationale?.trim()) {
    throw new Error("Prompt evaluation judgement rationale is required");
  }
  if (!Array.isArray(parsed.evidence)) {
    throw new Error("Prompt evaluation judgement evidence must be an array");
  }
  return parsed;
}

async function runSingleEvaluation(
  sample: PromptEvaluationSample,
  runtime: AgentRuntime,
  judgeRuntime: AgentRuntime,
  invoker: PromptEvaluationInvoker
): Promise<PromptEvaluationResult> {
  try {
    const targetOutput = await invoker.invoke({ runtime, prompt: buildPromptEvaluationTargetPrompt(sample, runtime) });
    const judgementOutput = await invoker.invoke({ runtime: judgeRuntime, prompt: buildPromptEvaluationJudgePrompt({ sample, runtime, targetOutput }) });
    const judgement = parsePromptEvaluationJudgement(judgementOutput);
    return { sampleId: sample.id, runtime, status: judgement.status, targetOutput, judgement, error: null };
  } catch (error) {
    return {
      sampleId: sample.id,
      runtime,
      status: "error",
      targetOutput: null,
      judgement: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Prompt evaluation judgement did not contain a JSON object");
  }
  return raw.slice(start, end + 1);
}
