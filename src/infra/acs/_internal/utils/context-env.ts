import { CONTEXT_KEYS } from "../../context-keys";

/**
 * 从上下文构造环境变量对象。
 * 供各 runtime 在 spawn 时注入，使子进程自动感知当前上下文。
 *
 * context 的 key 从源头统一为 SNAIL_CTX_* 格式，直接展开，不做映射。
 */
export function buildContextEnv(input: {
  workspacePath?: string | null;
  context?: Record<string, unknown>;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (input.workspacePath) env[CONTEXT_KEYS.WORKSPACE_PATH] = input.workspacePath;

  // context 的 key 从源头统一为 SNAIL_CTX_* 格式，直接展开
  if (input.context) {
    for (const [key, value] of Object.entries(input.context)) {
      if (value != null) {
        env[key] = String(value);
      }
    }
  }

  return env;
}
