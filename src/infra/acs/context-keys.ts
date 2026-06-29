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
  /** 当前 Snail Key（context 短名，与 buildContextEnv 注入的 env var 名一致） */
  SNAIL_KEY: "snail_key",
} as const;

