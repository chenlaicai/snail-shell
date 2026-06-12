import type { LobbyCommand, LobbyCommandType } from "@domain/im/model";

const COMMAND_PATTERN = /^\/(\w+)(?:\s+(.+))?$/;

const COMMAND_MAP: Record<string, LobbyCommandType> = {
  workspaces: "workspaces",
  issues: "issues",
  enter: "enter",
  back: "back",
  lobby: "lobby",
  status: "status",
  help: "help",
};

export function parseLobbyCommand(text: string): LobbyCommand {
  const trimmed = text.trim();
  const match = trimmed.match(COMMAND_PATTERN);
  if (!match) return { type: "unknown", argument: null };
  const cmd = match[1].toLowerCase();
  const arg = match[2]?.trim() || null;
  const type = COMMAND_MAP[cmd];
  if (!type) return { type: "unknown", argument: cmd };
  return { type, argument: arg };
}
