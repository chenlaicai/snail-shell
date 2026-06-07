import type { SnailRuntimeMessageInput } from "./interface";
import { ensureMcpServers } from "./mcp-config";
import { ensureSkillSymlinks } from "./skill-symlinks";
import { buildContextEnv } from "./context-env";

/**
 * 执行 capability 注入前导：ensureMcpServers + ensureSkillSymlinks + buildContextEnv。
 * 所有 agent 在 invokeMessage 中调用此方法。
 */
export function prepareAgentInvocation(
  input: SnailRuntimeMessageInput,
  agentType: "claude" | "codex" | "opencode",
): { contextEnv: Record<string, string> } {
  ensureMcpServers(input.capability.mcpServers, input.workspaceRoot, agentType);
  ensureSkillSymlinks(input.workspaceRoot, input.capability.skills);
  return { contextEnv: buildContextEnv(input.conversation) };
}
