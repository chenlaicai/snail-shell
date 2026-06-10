// ── 会话 ──────────────────────────────────────────────────────────────

export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
export type ConversationOwnerType = "workspace_stage" | "evolution";

export interface Conversation {
  id: string;
  workspace_id: string | null;
  issue_id: string | null;
  stage_id: string | null;
  owner_type: ConversationOwnerType;
  owner_id: string | null;
  title: string;
  kind: ConversationKind;
  status: ConversationStatus;
  default_role: string;
  participating_roles: string[];
  summary: string | null;
  from_conversation_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateConversationInput {
  id: string;
  workspace_id: string | null;
  issue_id: string | null;
  stage_id: string | null;
  owner_type?: ConversationOwnerType;
  owner_id?: string | null;
  title: string;
  kind: ConversationKind;
  default_role: string;
  participating_roles: string[];
  summary?: string;
  from_conversation_ids?: string[];
}

// ── 消息 ──────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";
export type MessageRuntime = "claude" | "opencode" | "codex" | "system" | "unknown";
export type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled" | "pending_approval";

export interface Message {
  id: number;
  conversation_id: string;
  client_id: string | null;
  from_role: string | null;
  to_roles: string[];
  role: MessageRole;
  quoted_message_id: number | null;
  context_cutoff_at: string;
  runtime: MessageRuntime | null;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateMessageInput {
  conversation_id: string;
  client_id?: string | null;
  from_role: string | null;
  to_roles: string[];
  role: MessageRole;
  quoted_message_id?: number | null;
  context_cutoff_at?: string;
  runtime?: MessageRuntime | null;
  status?: MessageStatus;
}

// ── 消息事件 ──────────────────────────────────────────────────────────

export type MessageEventCategory = "content" | "signal";
export type MessageEventKind = "start" | "text" | "content_block" | "tool_call" | "tool_result" | "command" | "command_result" | "signal" | "error";

export interface MessageEvent {
  id: number;
  message_id: number;
  seq: number;
  category: MessageEventCategory;
  kind: MessageEventKind;
  payload: unknown;
  source: unknown;
  created_at: string;
}

// ── 消息上下文 ────────────────────────────────────────────────────────

export type MessageContextKind = "final_text" | "message_out" | "event_summary" | "llm_summary" | "mcp_final_body";

export interface MessageContext {
  message_id: number;
  kind: MessageContextKind;
  context: string;
  updated_at: string;
}

// ── 消息分发 ──────────────────────────────────────────────────────────

export type MessageDispatchStatus = "pending" | "seen" | "consumed" | "skipped";

export interface MessageDispatch {
  id: number;
  conversation_id: string;
  message_id: number;
  to_role: string;
  status: MessageDispatchStatus;
  consumed_by_message_id: number | null;
  created_at: string;
  consumed_at: string | null;
}

// ── IM 渠道 ──────────────────────────────────────────────────────────

export type ChannelType = "feishu" | "wecom";

export interface IMInboundMessage {
  tenant_key?: string;
  chat_id: string;
  message_id: string;
  text: string;
}

export interface IMOutboundMessage {
  chat_id: string;
  text: string;
  uuid?: string;
}

export interface IMChannelConfig {
  type: ChannelType;
  enabled: boolean;
  allowed_chats: string[];
  max_text_length: number;
  streaming_enabled: boolean;
}

// ── Lobby ─────────────────────────────────────────────────────────────

export type NavigationLevel = "lobby" | "workspace_list" | "issue_list" | "in_conversation";

export interface LobbySession {
  id: string;
  channel_type: ChannelType;
  channel_chat_id: string;
  channel_tenant_key: string | null;
  navigation_level: NavigationLevel;
  current_workspace_id: string | null;
  current_issue_id: string | null;
  current_conversation_id: string | null;
  last_command_at: string;
  created_at: string;
  updated_at: string;
}

export interface LobbyMessage {
  id: number;
  lobby_session_id: string;
  direction: "inbound" | "outbound";
  command: string | null;
  content: string;
  response_content: string | null;
  created_at: string;
}
