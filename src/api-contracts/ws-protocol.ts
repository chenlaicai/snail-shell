// ws-protocol.ts — WebSocket 消息类型（client→server / server→client）
// RealtimeConversationEvent 已迁移到 agent-runtime 模块，暂时内联定义
export type RealtimeConversationEvent =
  | { type: "message_started"; message_id: number; status: string; role_name: string; role: string; client_id?: string }
  | { type: "message_event_appended"; message_id: number; role_name: string; event: Record<string, unknown>; client_id?: string }
  | { type: "message_context_updated"; message_id: number; role_name: string; context: Record<string, unknown> | null; client_id?: string }
  | { type: "message_status_changed"; message_id: number; role_name: string; status: string; final_role?: string; client_id?: string; context?: Record<string, unknown> | null }
  | { type: "permission_required"; message_id: number; role_name: string; request: Record<string, unknown> };

import type { StageSuggestion } from "./dto/issue.dto";

// ── Client → Server ──
export interface WsSendMessage {
  type: "send_message";
  content?: string;
  events?: Array<{ kind: "text" | "content_block"; payload: unknown }>;
  from_role?: string;
  producer_role?: string;
  quoted_message_id?: number;
  asker_role?: string;
  client_id?: string;
}

export type WsClientMessage = WsSendMessage;

// ── Server → Client ──
export interface WsAgentEvent {
  type: "agent_event";
  conversation_id: string;
  event: RealtimeConversationEvent;
}

export interface WsError {
  type: "error";
  error: string;
  hint?: string;
  client_id?: string;
}

export interface WsConversationBadge {
  type: "conversation_badge";
  payload: {
    conversation_id: string;
    issue_id: string | null;
    stage_id: string | null;
    boss_pending_count: number;
  };
}

export interface WsStageSuggestion {
  type: "stage_suggestion";
  payload: StageSuggestion;
}

export type WsServerMessage =
  | WsAgentEvent
  | WsError
  | WsConversationBadge
  | WsStageSuggestion;
