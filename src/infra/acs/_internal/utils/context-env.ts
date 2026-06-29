import { CONTEXT_KEYS } from "@infra/acs/context-keys";

/**
 * 从上下文构造环境变量对象。
 * 供各 runtime 在 spawn 时注入，使子进程自动感知当前上下文。
 *
 * context 的 key 统一添加 SNAIL_CTX_ 前缀后展开，消除两套 key 混乱。
 */
export function buildContextEnv(input: {
  workspacePath?: string | null;
  context?: Record<string, unknown>;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (input.workspacePath) env[CONTEXT_KEYS.WORKSPACE_PATH] = input.workspacePath;

  // context 的 key 统一添加 SNAIL_CTX_ 前缀，消除两套 key 混乱
  if (input.context) {
    for (const [key, value] of Object.entries(input.context)) {
      if (value != null) {
        env[`SNAIL_CTX_${key}`] = String(value);
      }
    }
  }

  return env;
}
