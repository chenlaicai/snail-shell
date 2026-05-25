// Test buildArgs() to ensure parameter consistency between new and resume paths.
// This test validates the guard profile changes:
// 1. No --dangerously-bypass-approvals-and-sandbox (security: restore Codex default sandbox + approvals)
// 2. No --ephemeral flag (would break session persistence)
// 3. CODEX_HOME env points to .codex/ for config.toml loading
// 4. No --ignore-user-config (config.toml must be loaded)

import { buildArgs, buildCodexSpawnEnv } from "../../src/agent/codex";
import type { StatefulInvocationInput } from "../../src/agent/interface";
import * as path from "path";

function testNewSessionArgs(): void {
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: {
      systemPrompt: "test system prompt",
      messages: [],
    },
    incrementalMessages: [],
  };

  const args = buildArgs("claude-opus-4", input);

  // 1. No --ephemeral flag
  if (args.includes("--ephemeral")) {
    throw new Error("FAIL: New session should NOT include --ephemeral flag");
  }

  // 2. Does NOT include bypass flag (security: restore default sandbox)
  if (args.includes("--dangerously-bypass-approvals-and-sandbox")) {
    throw new Error("FAIL: New session must NOT include --dangerously-bypass-approvals-and-sandbox");
  }

  // 3. Includes stdin indicator
  if (!args.includes("-")) {
    throw new Error("FAIL: New session must include stdin indicator '-'");
  }

  // 4. Includes model
  if (!args.includes("--model") || !args.includes("claude-opus-4")) {
    throw new Error("FAIL: New session must include --model and model name");
  }

  // 5. Includes --json
  if (!args.includes("--json")) {
    throw new Error("FAIL: New session must include --json");
  }

  console.log("✓ testNewSessionArgs passed");
}

function testResumeSessionArgs(): void {
  const input: StatefulInvocationInput = {
    sessionId: "test-thread-id",
    bootstrap: null,
    incrementalMessages: [{ role: "user", content: "test message" }],
  };

  const args = buildArgs("claude-opus-4", input);

  // 1. Does NOT include bypass flag (security: restore default sandbox)
  if (args.includes("--dangerously-bypass-approvals-and-sandbox")) {
    throw new Error("FAIL: Resume session must NOT include --dangerously-bypass-approvals-and-sandbox");
  }

  // 2. Includes stdin indicator
  if (!args.includes("-")) {
    throw new Error("FAIL: Resume session must include stdin indicator '-'");
  }

  // 3. Uses correct resume command structure
  const resumeIndex = args.indexOf("resume");
  if (resumeIndex === -1 || args[resumeIndex - 1] !== "exec") {
    throw new Error("FAIL: Resume must use 'exec resume' command structure");
  }

  // 4. Includes session ID
  if (!args.includes("--session") || !args.includes("test-thread-id")) {
    throw new Error("FAIL: Resume must include --session and session ID");
  }

  // 5. Includes --json
  if (!args.includes("--json")) {
    throw new Error("FAIL: Resume session must include --json");
  }

  // 6. Should NOT include --model (resume uses existing session's model)
  if (args.includes("--model")) {
    throw new Error("FAIL: Resume should not include --model flag");
  }

  console.log("✓ testResumeSessionArgs passed");
}

function testParameterConsistency(): void {
  const newInput: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: {
      systemPrompt: "test system prompt",
      messages: [],
    },
    incrementalMessages: [],
  };

  const resumeInput: StatefulInvocationInput = {
    sessionId: "test-thread-id",
    bootstrap: null,
    incrementalMessages: [{ role: "user", content: "test message" }],
  };

  const newSessionArgs = buildArgs("claude-opus-4", newInput);
  const resumeSessionArgs = buildArgs("claude-opus-4", resumeInput);

  // Both must have --json
  if (!newSessionArgs.includes("--json") || !resumeSessionArgs.includes("--json")) {
    throw new Error("FAIL: Both paths must include --json");
  }

  // Neither should have bypass flag (security: restore default sandbox)
  const bypassFlag = "--dangerously-bypass-approvals-and-sandbox";
  if (newSessionArgs.includes(bypassFlag) || resumeSessionArgs.includes(bypassFlag)) {
    throw new Error("FAIL: Neither path should include bypass flag");
  }

  // Both must have stdin indicator
  if (!newSessionArgs.includes("-") || !resumeSessionArgs.includes("-")) {
    throw new Error("FAIL: Both paths must include stdin indicator");
  }

  // Neither should have --ephemeral (breaks persistence)
  if (newSessionArgs.includes("--ephemeral") || resumeSessionArgs.includes("--ephemeral")) {
    throw new Error("FAIL: Neither path should include --ephemeral (breaks session persistence)");
  }

  console.log("✓ testParameterConsistency passed");
}

function testCodexSpawnEnvSetsCodexHome(): void {
  const env = buildCodexSpawnEnv();
  const expected = path.join(process.cwd(), ".codex");
  if (env.CODEX_HOME !== expected) {
    throw new Error(`FAIL: CODEX_HOME should be ${expected}, got ${env.CODEX_HOME}`);
  }
  console.log("✓ testCodexSpawnEnvSetsCodexHome passed");
}

function testCodexArgsNoIgnoreUserConfig(): void {
  const input: StatefulInvocationInput = {
    sessionId: null,
    bootstrap: { systemPrompt: "test", messages: [] },
    incrementalMessages: [],
  };
  const args = buildArgs("claude-opus-4", input);
  if (args.includes("--ignore-user-config")) {
    throw new Error("FAIL: should NOT include --ignore-user-config (config.toml must be loaded)");
  }
  console.log("✓ testCodexArgsNoIgnoreUserConfig passed");
}

// Run all tests
console.log("Running Codex buildArgs tests...");
testNewSessionArgs();
testResumeSessionArgs();
testParameterConsistency();
testCodexSpawnEnvSetsCodexHome();
testCodexArgsNoIgnoreUserConfig();
console.log("All Codex buildArgs tests passed!");
