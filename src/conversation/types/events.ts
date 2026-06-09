/**
 * 消息事件类型
 *
 * 定义消息事件的详细结构。
 */

import type { MessageContentBlock } from "./content-blocks";

/** 消息运行时类型 */
export type MessageRuntime = "claude" | "opencode" | "codex" | "system" | "unknown";

/** 消息信号类型 */
export type MessageSignalType = "step_start" | "step_finish" | "turn_started" | "turn_completed" | "runtime_usage" | "message_completed" | "message_failed" | "message_interrupted" | "message_cancelled" | "permission_blocked" | "message_pending_approval";

/** 消息上下文类型 */
export type MessageContextKind = "final_text" | "message_out" | "event_summary" | "llm_summary" | "mcp_final_body";

/** 消息派发状态 */
export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";

/** 会话所有者类型 */
export type ConversationOwnerType = "workspace_stage" | "evolution";

/** 消息事件来源 */
export interface MessageEventSource {
  runtime: MessageRuntime;
  model?: string;
  sessionId?: string;
}

/** 开始事件载荷 */
export interface StartEventPayload {
  role: string;
}

/** 文本事件载荷 */
export interface TextEventPayload {
  text: string;
}

/** 内容块事件载荷 */
export interface ContentBlockEventPayload {
  blocks: MessageContentBlock[];
  fallback_text?: string;
}

/** 工具调用事件载荷 */
export interface ToolCallEventPayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

/** 工具结果事件载荷 */
export interface ToolResultEventPayload {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** 命令事件载荷 */
export interface CommandEventPayload {
  command: string;
  args: string[];
}

/** 命令结果事件载荷 */
export interface CommandResultEventPayload {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/** 信号事件载荷 */
export interface SignalEventPayload {
  signal: MessageSignalType;
  data?: Record<string, unknown>;
}

/** 错误事件载荷 */
export interface ErrorEventPayload {
  error: string;
  code?: string;
}

/** 消息事件载荷联合类型 */
export type MessageEventPayload =
  | StartEventPayload
  | TextEventPayload
  | ContentBlockEventPayload
  | ToolCallEventPayload
  | ToolResultEventPayload
  | CommandEventPayload
  | CommandResultEventPayload
  | SignalEventPayload
  | ErrorEventPayload;

/** 派发收件箱组 */
export interface DispatchInboxGroup {
  conversation_id: string;
  to_role: string;
  count: number;
  latest_message_id: number;
  latest_created_at: string;
}

/** 派发收件箱预览项 */
export interface DispatchInboxPreviewItem {
  conversation_id: string;
  message_id: number;
  to_role: string;
  status: string;
  created_at: string;
}

/** 会话历史搜索结果 */
export interface ConversationHistorySearchResult {
  conversation_id: string;
  message_id: number;
  role: string;
  content: string;
  snippet: string;
  created_at: string;
}

/** 消息上下文摘要输入 */
export interface MessageContextSummaryInput {
  context: string;
  targetChars: number;
}

/** 消息上下文摘要生成器 */
export interface MessageContextSummaryGenerator {
  generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string>;
}
