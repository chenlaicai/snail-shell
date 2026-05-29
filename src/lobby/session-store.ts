import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { LobbyMessage, LobbySession, NavigationLevel } from "./types";

export class LobbySessionStore {
  constructor(private readonly db: Database.Database) {}

  getOrCreate(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession {
    const existing = this.getByChannel(channelType, channelChatId, channelTenantKey);
    if (existing) return existing;

    const id = randomUUID();
    const tenantNorm = channelTenantKey ?? null;
    this.db.prepare(`
      INSERT INTO lobby_session (id, channel_type, channel_chat_id, channel_tenant_key)
      VALUES (?, ?, ?, ?)
    `).run(id, channelType, channelChatId, tenantNorm);
    return this.get(id)!;
  }

  get(id: string): LobbySession | null {
    const row = this.db.prepare("SELECT * FROM lobby_session WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapLobbySession(row) : null;
  }

  getByChannel(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession | null {
    const tenantNorm = channelTenantKey ?? null;
    const row = this.db.prepare(
      "SELECT * FROM lobby_session WHERE channel_type = ? AND channel_chat_id = ? AND channel_tenant_key IS ?"
    ).get(channelType, channelChatId, tenantNorm) as Record<string, unknown> | undefined;
    return row ? mapLobbySession(row) : null;
  }

  updateNavigation(id: string, updates: {
    navigation_level?: NavigationLevel;
    current_project_id?: string | null;
    current_feature_id?: string | null;
    current_stage_id?: string | null;
    current_conversation_id?: string | null;
  }): LobbySession {
    const fields = ["navigation_level", "current_project_id", "current_feature_id", "current_stage_id", "current_conversation_id"] as const;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const field of fields) {
      if (updates[field] !== undefined) { sets.push(`${field} = ?`); values.push(updates[field]); }
    }
    if (sets.length === 0) return this.get(id)!;
    sets.push("updated_at = datetime('now')", "last_command_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE lobby_session SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.get(id)!;
  }

  listAll(): LobbySession[] {
    const rows = this.db.prepare("SELECT * FROM lobby_session ORDER BY updated_at DESC").all() as Record<string, unknown>[];
    return rows.map(mapLobbySession);
  }

  /** 获取指定通道类型中仍在房间内且有活跃 conversation 的会话，用于启动时 rehydrate 出站订阅 */
  getActiveConversations(channelType: string): LobbySession[] {
    const rows = this.db.prepare(
      "SELECT * FROM lobby_session WHERE channel_type = ? AND navigation_level = 'in_conversation' AND current_conversation_id IS NOT NULL"
    ).all(channelType) as Record<string, unknown>[];
    return rows.map(mapLobbySession);
  }

  addMessage(input: {
    lobby_session_id: string;
    direction: "inbound" | "outbound";
    command?: string | null;
    content: string;
    response_content?: string | null;
  }): LobbyMessage {
    const result = this.db.prepare(`
      INSERT INTO lobby_message (lobby_session_id, direction, command, content, response_content)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.lobby_session_id, input.direction, input.command ?? null, input.content, input.response_content ?? null);
    return this.getMessage(Number(result.lastInsertRowid))!;
  }

  getMessage(id: number): LobbyMessage | null {
    const row = this.db.prepare("SELECT * FROM lobby_message WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapLobbyMessage(row) : null;
  }

  getMessages(sessionId: string, limit = 50, offset = 0): LobbyMessage[] {
    const rows = this.db.prepare(
      "SELECT * FROM lobby_message WHERE lobby_session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(sessionId, limit, offset) as Record<string, unknown>[];
    return rows.map(mapLobbyMessage);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM lobby_session WHERE id = ?").run(id);
  }
}

function mapLobbySession(row: Record<string, unknown>): LobbySession {
  return {
    id: String(row.id),
    channel_type: String(row.channel_type),
    channel_chat_id: String(row.channel_chat_id),
    channel_tenant_key: row.channel_tenant_key != null ? String(row.channel_tenant_key) : null,
    navigation_level: String(row.navigation_level) as LobbySession["navigation_level"],
    current_project_id: row.current_project_id != null ? String(row.current_project_id) : null,
    current_feature_id: row.current_feature_id != null ? String(row.current_feature_id) : null,
    current_stage_id: row.current_stage_id != null ? String(row.current_stage_id) : null,
    current_conversation_id: row.current_conversation_id != null ? String(row.current_conversation_id) : null,
    last_command_at: String(row.last_command_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapLobbyMessage(row: Record<string, unknown>): LobbyMessage {
  return {
    id: Number(row.id),
    lobby_session_id: String(row.lobby_session_id),
    direction: String(row.direction) as LobbyMessage["direction"],
    command: row.command != null ? String(row.command) : null,
    content: String(row.content),
    response_content: row.response_content != null ? String(row.response_content) : null,
    created_at: String(row.created_at),
  };
}
