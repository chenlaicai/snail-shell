import assert from "assert";
import { getPromptEvaluationSample, listPromptEvaluationSamples, summarizePromptEvaluationCoverage } from "../../src/meta/prompt-evaluation-registry";

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

console.log("prompt evaluation asset tests passed");
