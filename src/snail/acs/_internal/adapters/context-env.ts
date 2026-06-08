/**
 * 运行时上下文环境变量。
 *
 * 将 conversation/issue/stage ID 注入子进程环境变量，
 * 使 skill 脚本通过 process.env.SNAIL_CTX_* 自动感知当前上下文。
 */

/**
 * 从 conversation 上下文构建环境变量。
 */
export function buildContextEnv(context: {
  issue_id?: string;
  conversation_id?: string;
  stage_id?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (context.issue_id) env.SNAIL_CTX_ISSUE_ID = context.issue_id;
  if (context.conversation_id) env.SNAIL_CTX_CONVERSATION_ID = context.conversation_id;
  if (context.stage_id) env.SNAIL_CTX_STAGE_ID = context.stage_id;
  return env;
}
