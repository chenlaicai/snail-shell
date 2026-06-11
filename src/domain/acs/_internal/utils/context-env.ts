/**
 * 从上下文 ID 构造环境变量对象。
 * 供各 runtime 在 spawn 时注入，使子进程（含 skill 脚本）自动感知当前上下文。
 *
 * 注意：SNAIL_CTX_* 命名与 db-bridge.js parseArgs() 耦合，改名需同步。
 */
export function buildContextEnv(context: {
  issueId?: string | null;
  conversationId?: string | null;
  stageId?: string | null;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (context.issueId) env.SNAIL_CTX_ISSUE_ID = context.issueId;
  if (context.conversationId) env.SNAIL_CTX_CONVERSATION_ID = context.conversationId;
  if (context.stageId) env.SNAIL_CTX_STAGE_ID = context.stageId;
  return env;
}
