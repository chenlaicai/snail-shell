import type { NavigationLevel } from "../shared/domain-types";
export type { NavigationLevel, LobbySession, LobbyMessage } from "../shared/domain-types";

export type LobbyCommandType = "workspaces" | "issues" | "enter" | "back" | "lobby" | "status" | "unknown" | "help";

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
  workspace: { id: string; name: string } | null;
  issue: { id: string; title: string } | null;
  stage: { id: string; type: string } | null;
  conversation: { id: string; title: string } | null;
}
