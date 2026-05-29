export type NavigationLevel = "lobby" | "project_list" | "feature_list" | "in_conversation";

export interface LobbySession {
  id: string;
  channel_type: string;
  channel_chat_id: string;
  channel_tenant_key: string | null;
  navigation_level: NavigationLevel;
  current_project_id: string | null;
  current_feature_id: string | null;
  current_stage_id: string | null;
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

export type LobbyCommandType = "projects" | "features" | "enter" | "back" | "lobby" | "status" | "unknown" | "help";

export interface LobbyCommand {
  type: LobbyCommandType;
  argument: string | null;
}

export interface LobbyResponse {
  text: string;
  /** 预留：未来 IM 卡片格式（飞书 interactive card 等） */
  card?: unknown;
}

export interface NavigationContext {
  level: NavigationLevel;
  project: { id: string; name: string } | null;
  feature: { id: string; title: string } | null;
  stage: { id: string; type: string } | null;
  conversation: { id: string; title: string } | null;
}
