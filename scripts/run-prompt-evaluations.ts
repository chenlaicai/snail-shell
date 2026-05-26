import fs from "fs";
import path from "path";
import type { AgentEvent, AgentRuntime, StatefulInvocationInput, StatelessInvocationInput } from "../src/agent/interface";
import { ClaudeCodeAgent, CodexAgent, OpenCodeAgent } from "../src";
import { listPromptEvaluationSamples } from "../src/prompt-center/evaluation-registry";
import { collectPromptEvaluationText, runPromptEvaluations, type PromptEvaluationInvoker } from "../src/prompt-center/evaluation-runner";

interface ParsedArgs {
  judgeRuntime: AgentRuntime;
  outputPath: string;
  sampleIds: Set<string> | null;
  runtimes: Set<AgentRuntime> | null;
}

class RuntimePromptEvaluationInvoker implements PromptEvaluationInvoker {
  async invoke(input: { runtime: AgentRuntime; prompt: string }): Promise<string> {
    const events: AgentEvent[] = [];
    if (input.runtime === "claude-code-cli") {
      await new ClaudeCodeAgent().invokeStateless(buildStatelessInput(input.prompt), (event) => events.push(event));
    } else if (input.runtime === "opencode-cli") {
      await new OpenCodeAgent().invokeStateful(buildStatefulInput(input.prompt), (event) => events.push(event));
    } else if (input.runtime === "codex-cli") {
      await new CodexAgent().invokeStateful(buildStatefulInput(input.prompt), (event) => events.push(event));
    } else {
      throw new Error(`Unsupported prompt evaluation runtime: ${input.runtime}`);
    }
    return collectPromptEvaluationText(events);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const samples = listPromptEvaluationSamples()
    .filter((sample) => !args.sampleIds || args.sampleIds.has(sample.id))
    .map((sample) => args.runtimes ? { ...sample, agent_runtimes: sample.agent_runtimes.filter((runtime) => args.runtimes?.has(runtime)) } : sample)
    .filter((sample) => sample.agent_runtimes.length > 0);
  const report = await runPromptEvaluations({ samples, judgeRuntime: args.judgeRuntime, invoker: new RuntimePromptEvaluationInvoker() });
  fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
  fs.writeFileSync(args.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const getValue = (name: string): string => {
    const index = argv.indexOf(name);
    if (index === -1 || index === argv.length - 1) return "";
    return argv[index + 1] ?? "";
  };
  const judgeRuntime = parseRuntime(getValue("--judge-runtime") || "opencode-cli");
  const outputPath = getValue("--output") || path.join(process.cwd(), ".meta", "prompt-evaluations", "latest-report.json");
  const sampleIds = parseSet(getValue("--samples"));
  const runtimes = parseRuntimeSet(getValue("--runtimes"));
  return { judgeRuntime, outputPath, sampleIds, runtimes };
}

function parseRuntime(value: string): AgentRuntime {
  if (value === "opencode-cli" || value === "claude-code-cli" || value === "codex-cli") return value;
  throw new Error(`Unsupported runtime: ${value}`);
}

function parseRuntimeSet(value: string): Set<AgentRuntime> | null {
  const values = parseSet(value);
  if (!values) return null;
  return new Set(Array.from(values).map(parseRuntime));
}

function parseSet(value: string): Set<string> | null {
  if (!value) return null;
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function buildStatelessInput(prompt: string): StatelessInvocationInput {
  return { systemPrompt: "你是 Snail Shell 提示词效果评估运行时。", systemReminder: "", messages: [{ role: "user", content: prompt }] };
}

function buildStatefulInput(prompt: string): StatefulInvocationInput {
  return {
    sessionId: null,
    bootstrap: { systemPrompt: "你是 Snail Shell 提示词效果评估运行时。", messages: [] },
    incrementalMessages: [{ role: "user", content: prompt }],
    systemReminder: "",
  };
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
