// ── Message ───────────────────────────────────────────────────────────

export type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled";

export interface Message {
  /** 自增整数，ReadCursor 依赖 id 大小判断未读（id > cursor = 未读） */
  id: number;
  stage_id: string;
  /** 发言者（角色实例名如 "开发者"、用户名如 "user"、系统为 null） */
  from_speaker: string | null;
  /** 目标发言者列表，包含 "user" 表示通知人类 */
  to_speakers: string[];
  status: MessageStatus;
  created_at: string;
  /** 到达终态的时间 */
  ended_at: string | null;
}

export interface CreateMessageInput {
  stage_id: string;
  from_speaker: string | null;
  to_speakers: string[];
  status?: MessageStatus;
}

// ── MessageEvent ──────────────────────────────────────────────────────
// Agent 消息的流式过程记录。记录 Agent 产出回复时的中间步骤（文本、工具调用等）。
// 用户消息和系统消息不需要事件流，内容直接写入 MessageContext。
// 各 Agent 适配器负责将原生格式翻译为统一格式。
// 7 种 type：start、text、tool_call、tool_result、signal、error、usage
// payload 的 type 字段是 discriminant，用于类型安全的条件判断。

export interface MessageEvent {
  id: number;
  message_id: number;
  /** 消息内排序，保证事件顺序 */
  seq: number;
  payload: MessageEventPayload;
  created_at: string;
}

// ── Payload（discriminated union，type 为 discriminant）──

export interface StartPayload {
  type: "start";
}

export interface TextPayload {
  type: "text";
  text: string;
}

export interface ToolCallPayload {
  type: "tool_call";
  tool_name: string;
  tool_input: unknown;
}

export interface ToolResultPayload {
  type: "tool_result";
  tool_name: string;
  result: unknown;
}

export interface SignalPayload {
  type: "signal";
  signal: string;  // "message_completed" | "message_failed" | "message_interrupted" | ...
  [key: string]: unknown;
}

export interface ErrorPayload {
  type: "error";
  error: string;
}

export interface UsagePayload {
  type: "usage";
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
  cached_input_tokens?: number;
  [key: string]: unknown;
}

export type MessageEventPayload =
  | StartPayload
  | TextPayload
  | ToolCallPayload
  | ToolResultPayload
  | SignalPayload
  | ErrorPayload
  | UsagePayload;

// ── MessageContext ─────────────────────────────────────────────────────
// 消息的最终答复内容，（同时供后续 Agent 构建对话历史时注入 prompt）
// 用户消息：直接写入（无事件流）。
// Agent 消息：来源可由agent自行mcp发送、也可cli输出最后一段、也可是系统级lite-ai总结而出。

export type MessageContextKind = "final_text" | "message_out" | "event_summary" | "llm_summary" | "mcp_final_body";

export interface MessageContext {
  /** 一对一关联 Message */
  message_id: number;
  kind: MessageContextKind;
  context: string;
  created_at: string;
}

// ── ReadCursor ────────────────────────────────────────────────────────

export interface ReadCursor {
  stage_id: string;
  speaker: string;
  last_read_message_id: number;
  updated_at: string;
}

// ── CallSignal ────────────────────────────────────────────────────────

export interface CallSignal {
  stage_id: string;
  target_speaker: string;
  created_at: string;
}
