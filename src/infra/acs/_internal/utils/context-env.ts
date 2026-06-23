import { CONTEXT_KEYS } from "@infra/acs/context-keys";

/** context key 到 SNAIL_CTX_* 环境变量名的映射 */
const CONTEXT_KEY_MAP: Record<string, string> = {
  issue_id: CONTEXT_KEYS.ISSUE_ID,
  stage_id: CONTEXT_KEYS.STAGE_ID,
  message_id: CONTEXT_KEYS.MESSAGE_ID,
  role_instance: CONTEXT_KEYS.ROLE_INSTANCE,
};

/**
 * 从上下文构造环境变量对象。
 * 供各 runtime 在 spawn 时注入，使子进程自动感知当前上下文。
 *
 * context 的 key 通过 CONTEXT_KEY_MAP 映射为 SNAIL_CTX_* 格式。
 */
export function buildContextEnv(input: {
  workspacePath?: string | null;
  context?: Record<string, unknown>;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (input.workspacePath) env[CONTEXT_KEYS.WORKSPACE_PATH] = input.workspacePath;

  if (input.context) {
    for (const [key, value] of Object.entries(input.context)) {
      if (value != null) {
        const envKey = CONTEXT_KEY_MAP[key] ?? key;
        env[envKey] = String(value);
      }
    }
  }

  return env;
}
