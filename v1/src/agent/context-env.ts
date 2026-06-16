import type { Conversation } from "../shared/types";

/**
 * 从 Conversation 中提取运行时上下文 ID，构造环境变量对象。
 * 供各 runtime 在 spawn 时注入，使子进程（含 skill 脚本）自动感知当前上下文。
 *
 * 设计选择 env 而非文件：纯内存传递，零 I/O；每次 spawn 独立副本，并发安全；
 * 已有先例（Codex 的 buildCodexSpawnEnv）。详见 F2026060404 feature 文档备选方案。
 *
 * 注意：SNAIL_CTX_* 命名与 db-bridge.js parseArgs() 耦合，改名需同步。
 */
export function buildContextEnv(conversation: Conversation): Record<string, string> {
  const env: Record<string, string> = {};
  if (conversation.issue_id) env.SNAIL_CTX_ISSUE_ID = conversation.issue_id;
  if (conversation.id) env.SNAIL_CTX_CONVERSATION_ID = conversation.id;
  if (conversation.stage_id) env.SNAIL_CTX_STAGE_ID = conversation.stage_id;
  return env;
}
