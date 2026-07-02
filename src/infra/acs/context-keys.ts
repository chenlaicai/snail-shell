/**
 * 环境变量 Key 常量。
 *
 * 统一管理 snail 注入到 agent 进程的环境变量 key。
 * skill 脚本通过 process.env[CONTEXT_KEYS.WORKSPACE_PATH] 获取。
 */
export const CONTEXT_KEYS = {
  /** 当前工作区路径 */
  WORKSPACE_PATH: "SNAIL_CTX_WORKSPACE_PATH",
  /** 当前 Issue ID */
  ISSUE_ID: "SNAIL_CTX_ISSUE_ID",
  /** 当前会话 ID */
  CONVERSATION_ID: "SNAIL_CTX_CONVERSATION_ID",
  /** 当前阶段 ID */
  STAGE_ID: "SNAIL_CTX_STAGE_ID",
  /** 当前消息 ID */
  MESSAGE_ID: "SNAIL_CTX_MESSAGE_ID",
  /** 当前 Snail Key */
  SNAIL_KEY: "SNAIL_CTX_SNAIL_KEY",
} as const;

/**
 * 从上下文构造环境变量对象。
 * 供各 runtime 在 spawn 时注入，使子进程自动感知当前上下文。
 *
 * context 的 key 统一添加 SNAIL_CTX_ 前缀后展开（已带前缀的 key 不重复添加），消除两套 key 混乱。
 */
export function buildContextEnv(input: {
  workspacePath?: string | null;
  context?: Record<string, unknown>;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (input.workspacePath) env[CONTEXT_KEYS.WORKSPACE_PATH] = input.workspacePath;

  // context 的 key 统一添加 SNAIL_CTX_ 前缀，已带前缀的 key 不重复添加
  if (input.context) {
    for (const [key, value] of Object.entries(input.context)) {
      if (value != null) {
        const envKey = key.startsWith("SNAIL_CTX_") ? key : `SNAIL_CTX_${key}`;
        env[envKey] = String(value);
      }
    }
  }

  return env;
}
