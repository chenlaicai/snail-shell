/** Agent 运行时类型 */
export type AgentRuntime =
  | "claude-code-cli"
  | "claude-code-stateful-cli"
  | "opencode-cli"
  | "codex-cli";

/** 上下文管理方 */
export type ContextProvider = "shell" | "agent";

/** Snail 模板（AI Agent 运行时配置） */
export interface SnailTemplate {
  id: string;
  name: string;
  runtime: AgentRuntime;
  model: string;
  context_window?: number;
  context_provider: ContextProvider;
  invocation_timeout_ms?: number;
}

/** Snail 运行时实例（解析后的模板） */
export interface SnailRuntimeInstance {
  template: SnailTemplate;
  model: string;
  context_window: number | null;
  invocation_timeout_ms: number | null;
}

/** Agent 会话 */
export interface SnailAgentSession {
  id: string;
  conversation_id: string;
  role_name: string;
  runtime: AgentRuntime;
  model: string;
  context_provider: ContextProvider;
  external_session_id: string | null;
  handoff_from_id: string | null;
  created_at: string;
}

/** 创建 Agent 会话输入 */
export interface CreateSnailAgentSessionInput {
  conversation_id: string;
  role_name: string;
  runtime: AgentRuntime;
  model: string;
  context_provider: ContextProvider;
  external_session_id?: string | null;
  handoff_from_id?: string | null;
}
