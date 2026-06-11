import { CONTEXT_KEYS } from "../../context-keys";

/**
 * 从上下文构造环境变量对象。
 * 供各 runtime 在 spawn 时注入，使子进程自动感知当前上下文。
 */
export function buildContextEnv(context: {
  workspacePath?: string | null;
  issueId?: string | null;
  conversationId?: string | null;
  stageId?: string | null;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (context.workspacePath) env[CONTEXT_KEYS.WORKSPACE_PATH] = context.workspacePath;
  if (context.issueId) env[CONTEXT_KEYS.ISSUE_ID] = context.issueId;
  if (context.conversationId) env[CONTEXT_KEYS.CONVERSATION_ID] = context.conversationId;
  if (context.stageId) env[CONTEXT_KEYS.STAGE_ID] = context.stageId;
  return env;
}
