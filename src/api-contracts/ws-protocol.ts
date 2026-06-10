// ws-protocol.ts — WebSocket 消息类型（client→server / server→client）
import type { RealtimeConversationEvent } from "../agent/interface";
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

export interface WsInterruptMessage {
  type: "interrupt";
  message_id: number;
}

export type WsClientMessage = WsSendMessage | WsInterruptMessage;

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
