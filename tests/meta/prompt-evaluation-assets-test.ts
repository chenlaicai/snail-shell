import assert from "assert";
import { getPromptEvaluationSample, listPromptEvaluationSamples, summarizePromptEvaluationCoverage } from "../../src/meta/prompt-evaluation-registry";
import { parsePromptEvaluationJudgement, runPromptEvaluations, type PromptEvaluationInvoker } from "../../src/meta/prompt-evaluation-runner";

const allSamples = listPromptEvaluationSamples();
assert(allSamples.length >= 5, "prompt evaluation registry should expose a reusable seed sample set");

const runtimeCoverage = summarizePromptEvaluationCoverage();
assert(runtimeCoverage.length === 3, "prompt evaluation coverage should summarize the three validated runtimes");
assert(runtimeCoverage.every((item) => item.sampleCount > 0), "each validated runtime should be covered by at least one prompt evaluation sample");

const crossRuntimeSample = allSamples.find((sample) => sample.agent_runtimes.length === 3);
assert(crossRuntimeSample, "at least one prompt evaluation sample should compare all validated runtimes");

const scopeBoundary = getPromptEvaluationSample("PE002");
assert.equal(scopeBoundary.dimension, "scope-boundary", "registry should preserve evaluation dimensions");
assert(scopeBoundary.expected_behaviors.some((item) => item.includes("问题线索")), "scope boundary sample should preserve expected behavior details");
assert(scopeBoundary.forbidden_behaviors.some((item) => item.includes("范围上限")), "scope boundary sample should preserve forbidden behavior details");

const runtimeDifferentiation = getPromptEvaluationSample("PE005");
assert(runtimeDifferentiation.expected_behaviors.some((item) => item.includes("按 runtime 分别记录结果")), "runtime differentiation sample should require per-runtime reporting");

const codexCoverage = runtimeCoverage.find((item) => item.runtime === "codex-cli");
assert(codexCoverage?.sampleIds.includes("PE005"), "coverage summary should retain sample ids for runtime-specific review");

async function main(): Promise<void> {
  const fakeInvoker: PromptEvaluationInvoker = {
    async invoke(input) {
      if (input.prompt.includes("JSON schema")) {
        return JSON.stringify({ status: "pass", rationale: `judge:${input.runtime}`, evidence: ["matched expected behavior"] });
      }
      return `target:${input.runtime}`;
    },
  };

  const report = await runPromptEvaluations({
    samples: [{ ...runtimeDifferentiation, agent_runtimes: ["opencode-cli", "codex-cli"] }],
    judgeRuntime: "claude-code-cli",
    invoker: fakeInvoker,
    now: () => new Date("2026-05-12T00:00:00.000Z"),
  });
  assert.equal(report.generatedAt, "2026-05-12T00:00:00.000Z", "runner should preserve report generation time");
  assert.equal(report.results.length, 2, "runner should create one result per sample-runtime pair");
  assert(report.results.every((result) => result.status === "pass"), "runner should preserve judge statuses");
  assert(report.results.some((result) => result.runtime === "codex-cli" && result.targetOutput === "target:codex-cli"), "runner should preserve target output per runtime");

  const judgement = parsePromptEvaluationJudgement("```json\n{\"status\":\"partial\",\"rationale\":\"ok\",\"evidence\":[\"one\"]}\n```");
  assert.equal(judgement.status, "partial", "judgement parser should accept JSON embedded in runtime text");

  console.log("prompt evaluation asset tests passed");
}

main().catch((error: unknown) => {
  throw error;
});
