import { renderStatefulPrompt } from "../../src/agent/stateful-prompt-format";
import { buildStatefulIncrementalMessages } from "../../src/agent/prompt-mapper";
import type { SnailRuntimeMessageInput, StatefulInvocationInput } from "../../src/agent/interface";
import type { MessageWithEvents } from "../../src/shared/types";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testStatefulPromptDoesNotAddPseudoTranscriptLabels(): void {
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: {
      systemPrompt: "当前 stage 规则要求先进入 worktree。",
      messages: [{ role: "assistant", content: "研发者:\n已完成环境准备。" }],
    },
    incrementalMessages: [{ role: "user", content: "继续" }],
    systemReminder: "",
  };

  const prompt = renderStatefulPrompt(input);

  assert(prompt.includes("## 当前任务上下文"), "system rules should be rendered as current task context");
  assert(prompt.includes("## 引用消息"), "bootstrap history should be rendered as quoted messages");
  assert(prompt.includes("## 新消息"), "incremental messages should be rendered as new messages");
  assert(prompt.includes("角色: assistant"), "message role metadata should remain explicit");
  assert(!prompt.includes("SYSTEM:\n"), "prompt must not wrap current rules with a pseudo SYSTEM label");
  assert(!prompt.includes("USER:\n"), "prompt must not create pseudo USER transcript boundaries");
  assert(!prompt.includes("ASSISTANT:\n"), "prompt must not create pseudo ASSISTANT transcript boundaries");
  console.log("✓ testStatefulPromptDoesNotAddPseudoTranscriptLabels passed");
}

function testStatefulIncrementalUserMessageDoesNotAddUserLabel(): void {
  const incrementalMessages = buildStatefulIncrementalMessages({
    incrementalMessages: [{ role: "user", context: { kind: "full", context: "你好" } } as unknown as MessageWithEvents],
  } as SnailRuntimeMessageInput);

  assert(incrementalMessages.length === 1, "one user incremental message should be mapped");
  assert(incrementalMessages[0]?.role === "user", "structured role metadata should preserve the user role");
  assert(incrementalMessages[0]?.content.includes("你好"), "message content should be preserved");
  assert(!incrementalMessages[0]?.content.startsWith("USER:\n"), "mapper must not prefix content with pseudo USER label");
  console.log("✓ testStatefulIncrementalUserMessageDoesNotAddUserLabel passed");
}

testStatefulPromptDoesNotAddPseudoTranscriptLabels();
testStatefulIncrementalUserMessageDoesNotAddUserLabel();
