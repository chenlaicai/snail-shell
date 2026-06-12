// ── IM 渠道 ──────────────────────────────────────────────────────────

export type ChannelType = "feishu" | "wecom";

export interface IMInboundMessage {
  tenant_key?: string;
  chat_id: string;
  message_id: string;
  text: string;
}

export interface IMChannelConfig {
  type: ChannelType;
  enabled: boolean;
  allowed_chats: string[];
  max_text_length: number;
  streaming_enabled: boolean;
}

// ── Lobby ─────────────────────────────────────────────────────────────

export type NavigationLevel = "lobby" | "workspace_list" | "issue_list" | "in_stage";

export interface LobbySession {
  id: string;
  channel_type: ChannelType;
  channel_chat_id: string;
  channel_tenant_key: string | null;
  navigation_level: NavigationLevel;
  current_workspace_id: string | null;
  current_issue_id: string | null;
  current_stage_id: string | null;
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

// ── Lobby Command ────────────────────────────────────────────────────

export type LobbyCommandType = "workspaces" | "issues" | "enter" | "back" | "lobby" | "status" | "unknown" | "help";

export interface LobbyCommand {
  type: LobbyCommandType;
  argument: string | null;
}

export interface LobbyResponse {
  text: string;
}

export interface NavigationContext {
  level: NavigationLevel;
  workspace: { path: string; summary: string | null } | null;
  issue: { id: string; title: string } | null;
  stage: { id: string; key: string } | null;
}
