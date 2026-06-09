import type { Conversation, CreateMessageEventInput, MessageContext, MessageEvent, MessageRole, MessageStatus, MessageWithEvents, AgentRuntime } from "../shared/types";
import type { RoleDefinition } from "../roles";
import type { AgentCapability } from "./capability";

export type { AgentRuntime };

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

// Snail Shell provides structured conversation context to the runtime layer.
// The runtime layer then chooses the right invocation model for the concrete agent:
// 1. stateless non-interactive runtimes receive fully reconstructed context for each message
// 2. stateful non-interactive runtimes receive bootstrap context once, then only the
//    newest message while the underlying agent maintains its own session state
// 3. concrete agent implementations finally translate that invocation contract into
//    CLI or API specific calls and stream events back to Snail Shell
//
// This separation is intentional. Snail Shell should not collapse all runtimes into
// one lowest-common-denominator abstraction because different coding agents have
// genuinely different strengths and state models. The first layer therefore preserves
// Snail Shell's own structured context, while lower layers adapt that context to the
// invocation style that a concrete runtime actually supports.

export interface ToolPermissionRequest {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export type AgentMessageStatus = MessageStatus;

export type AgentStopReason = "user_interrupt" | "system_timeout" | "server_shutdown";

export interface AgentStopDetail {
  reason: AgentStopReason;
  phase: "requested" | "graceful_wait" | "terminate_sent" | "kill_sent" | "closed" | "kill_unconfirmed";
  requested_at: string;
  closed_at?: string | null;
  graceful_timeout_ms: number;
  terminate_timeout_ms: number;
  kill_confirm_timeout_ms: number;
  forced: boolean;
  exit_code?: number | null;
  exit_signal?: NodeJS.Signals | string | null;
  process_group_signal_attempted?: boolean;
  process_group_signal_error?: string | null;
}

export type AgentEvent =
  | { type: "message_event"; event: CreateMessageEventInput }
  | { type: "permission_required"; request: ToolPermissionRequest }
  | { type: "message_failure"; error: string };

export type RealtimeConversationEvent =
  | { type: "message_started"; message_id: number; status: MessageStatus; role_name: string; role: MessageRole; client_id?: string }
  | ({ type: "message_event_appended"; message_id: number; role_name: string; event: MessageEvent; client_id?: string })
  | { type: "message_context_updated"; message_id: number; role_name: string; context: MessageContext | null; client_id?: string }
  | {
      type: "message_status_changed";
      message_id: number;
      role_name: string;
      status: MessageStatus;
      final_role?: MessageRole;
      client_id?: string;
      context?: MessageContext | null;
    }
  | { type: "permission_required"; message_id: number; role_name: string; request: ToolPermissionRequest };

export type PermissionDecision = "allow" | "deny";

export interface SnailRuntimeMessageInput {
  // This is the only runtime input shape that upper layers should construct.
  // It contains Snail Shell's structured view of the pending message before any runtime-specific
  // prompt flattening happens. Keep this object domain-oriented rather than CLI-shaped.
  workspaceRoot: string;
  conversation: Conversation;
  role: RoleDefinition;
  /** 结构化能力声明。systemPrompt 为静态规则，systemReminder 为动态上下文。 */
  capability: AgentCapability;
  history: AgentMessage[];
  latestUserEvents: CreateMessageEventInput[];
  incrementalMessages: MessageWithEvents[];
  /**
   * 当前 snail_agent_session 的 external_session_id。
   * stateful runtime 用此值 resume 已有会话；stateless runtime 忽略它。
   */
  externalSessionId: string | null;
}

export interface AgentInvocationResult {
  sessionId?: string | null;
  /** 等待 agent 子进程停止完成；shutdown 时用于确保所有子进程已退出。 */
  waitForStop?: () => Promise<void>;
}

export class AgentInvocationInterruptedError extends Error {
  readonly detail: AgentStopDetail | null;

  constructor(message = "Agent invocation interrupted", detail: AgentStopDetail | null = null) {
    super(message);
    this.name = "AgentInvocationInterruptedError";
    this.detail = detail;
  }
}

export class AgentInvocationTerminatedError extends Error {
  readonly detail: AgentStopDetail;

  constructor(message: string, detail: AgentStopDetail) {
    super(message);
    this.name = "AgentInvocationTerminatedError";
    this.detail = detail;
  }
}

export interface AgentInvocationOptions {
  signal?: AbortSignal;
  /** Snail Den template 指定的模型标识；agent 优先使用此值，未提供时 fallback 到默认模型。 */
  model?: string;
  /** Snail Den template 指定的上下文窗口大小；用于 runtime 未返回上下文窗口时的兜底。 */
  contextWindow?: number;
  /** Snail Den template 指定的调用超时（毫秒）；用于限制单次 agent 调用最大时长。未提供时使用 agent 默认值（30 分钟）。 */
  invocationTimeoutMs?: number;
  /** 运行时上下文环境变量（issue_id, conversation_id, stage_id），spawn 时注入子进程。 */
  contextEnv?: Record<string, string>;
}

export interface StatelessInvocationInput {
  // Stateless runtimes are reconstructed for each message from Snail Shell state.
  // They should receive the full conversation window that Snail Shell wants the
  // model to reason over for this specific reply.
  systemPrompt: string;
  /** 动态运行时上下文，仅在变化时注入（空字符串表示跳过） */
  systemReminder: string;
  messages: AgentMessage[];
}

export interface StatefulInvocationInput {
  // Stateful runtimes own their internal session context after bootstrap.
  // `sessionId` is bound to the current conversation+role slot inside Snail Shell.
  // `bootstrap` is provided only when the conversation does not yet have a runtime
  // session. After that, only the newest message sequence should be sent so the underlying agent
  // can manage its own context window, compaction, and continuation behavior.
  sessionId: string | null;
  bootstrap: {
    systemPrompt: string;
    messages: AgentMessage[];
  } | null;
  incrementalMessages: AgentMessage[];
  /** 动态运行时上下文，仅在变化时注入（空字符串表示跳过） */
  systemReminder: string;
}

export interface StatelessAgentInvoker {
  invokeStateless(
    input: StatelessInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions
  ): Promise<AgentInvocationResult>;
}

export interface StatefulAgentInvoker {
  invokeStateful(
    input: StatefulInvocationInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions
  ): Promise<AgentInvocationResult>;
}

export interface SnailRuntime {
  readonly name: string;
  readonly runtime: AgentRuntime;
  // This is the boundary between Snail Shell and all concrete runtimes. Everything
  // below this point can differ by runtime capability, but everything above this
  // point should continue to think in terms of structured runtime messages.
  invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult>;
}

export function isAgentInvocationInterrupted(error: unknown): boolean {
  return error instanceof AgentInvocationInterruptedError;
}

export function isAgentInvocationStopped(error: unknown): boolean {
  return error instanceof AgentInvocationInterruptedError || error instanceof AgentInvocationTerminatedError;
}

export function getAgentInvocationStopDetail(error: unknown): AgentStopDetail | null {
  if (error instanceof AgentInvocationInterruptedError) return error.detail;
  if (error instanceof AgentInvocationTerminatedError) return error.detail;
  return null;
}
