import type { LobbySession, LobbyMessage } from "../../lobby/types";

// Re-export lobby types directly
export type { LobbySession, LobbyMessage };

// Backward-compatible aliases
export type LobbySessionDto = LobbySession;
export type LobbyMessageDto = LobbyMessage;
