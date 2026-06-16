import { randomUUID } from "crypto";
import type { ChannelType, IMChannelConfig, LobbySession, LobbyMessage, NavigationLevel } from "@domain/im/model";
import type { SQLiteDatabase } from "@infra/database";

/** IM 持久层接口 */
export interface IMRepository {
  // IM 渠道配置
  listChannelConfigs(): IMChannelConfig[];
  getChannelConfig(type: string): IMChannelConfig | undefined;
  registerChannelConfig(config: IMChannelConfig): void;
}

// ── SQLite IM Repository ──────────────────────────────────────────────

const IM_SCHEMA = `
CREATE TABLE IF NOT EXISTS im_channel_config (
  type TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  allowed_chats TEXT NOT NULL,
  max_text_length INTEGER NOT NULL,
  streaming_enabled INTEGER NOT NULL
);
`;

export class SQLiteIMRepository implements IMRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(IM_SCHEMA);
  }

  listChannelConfigs(): IMChannelConfig[] {
    return this.db.all<IMChannelConfigRow>(
      `SELECT * FROM im_channel_config ORDER BY type ASC`,
    ).map(mapChannelConfig);
  }

  getChannelConfig(type: string): IMChannelConfig | undefined {
    const row = this.db.get<IMChannelConfigRow>(`SELECT * FROM im_channel_config WHERE type = ?`, [type]);
    return row ? mapChannelConfig(row) : undefined;
  }

  registerChannelConfig(config: IMChannelConfig): void {
    this.db.run(
      `INSERT INTO im_channel_config (type, enabled, allowed_chats, max_text_length, streaming_enabled)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET
         enabled = excluded.enabled,
         allowed_chats = excluded.allowed_chats,
         max_text_length = excluded.max_text_length,
         streaming_enabled = excluded.streaming_enabled`,
      [
        config.type,
        config.enabled ? 1 : 0,
        JSON.stringify(config.allowed_chats),
        config.max_text_length,
        config.streaming_enabled ? 1 : 0,
      ],
    );
  }
}

type IMChannelConfigRow = {
  type: ChannelType;
  enabled: number;
  allowed_chats: string;
  max_text_length: number;
  streaming_enabled: number;
};

function mapChannelConfig(row: IMChannelConfigRow): IMChannelConfig {
  return {
    type: row.type,
    enabled: row.enabled === 1,
    allowed_chats: JSON.parse(row.allowed_chats),
    max_text_length: row.max_text_length,
    streaming_enabled: row.streaming_enabled === 1,
  };
}

// ── Lobby Session Repository ────────────────────────────────────────

/** Lobby 持久层接口 */
export interface LobbySessionRepository {
  getOrCreate(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession;
  getByChannel(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession | null;
  get(id: string): LobbySession | null;
  updateNavigation(id: string, updates: {
    navigation_level?: NavigationLevel;
    current_workspace_id?: string | null;
    current_issue_id?: string | null;
    current_stage_id?: string | null;
  }): LobbySession;
  listAll(): LobbySession[];
  getInStageSessions(channelType: ChannelType): LobbySession[];
  addMessage(input: { lobby_session_id: string; direction: "inbound" | "outbound"; command?: string | null; content: string; response_content?: string | null }): LobbyMessage;
  getMessages(sessionId: string, limit?: number, offset?: number): LobbyMessage[];
}

// ── SQLite Lobby Repository ──────────────────────────────────────────

const LOBBY_SCHEMA = `
CREATE TABLE IF NOT EXISTS lobby_session (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL,
  channel_chat_id TEXT NOT NULL,
  channel_tenant_key TEXT,
  navigation_level TEXT NOT NULL DEFAULT 'lobby',
  current_workspace_id TEXT,
  current_issue_id TEXT,
  current_stage_id TEXT,
  last_command_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel_type, channel_chat_id, channel_tenant_key)
);

CREATE TABLE IF NOT EXISTS lobby_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lobby_session_id TEXT NOT NULL REFERENCES lobby_session(id),
  direction TEXT NOT NULL,
  command TEXT,
  content TEXT NOT NULL,
  response_content TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lobby_message_session ON lobby_message(lobby_session_id, created_at DESC);
`;

/** SQLite 持久化实现 */
export class SQLiteLobbyRepository implements LobbySessionRepository {
  constructor(private db: SQLiteDatabase) {
    db.initSchema(LOBBY_SCHEMA);
  }

  getOrCreate(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession {
    const existing = this.getByChannel(channelType, channelChatId, channelTenantKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.run(
      `INSERT INTO lobby_session (id, channel_type, channel_chat_id, channel_tenant_key, navigation_level, last_command_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'lobby', ?, ?, ?)`,
      [id, channelType, channelChatId, channelTenantKey, now, now, now],
    );
    return this.get(id)!;
  }

  getByChannel(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession | null {
    const row = this.db.get<LobbySession>(
      `SELECT * FROM lobby_session WHERE channel_type = ? AND channel_chat_id = ? AND channel_tenant_key IS ?`,
      [channelType, channelChatId, channelTenantKey],
    );
    return row ? this.mapSession(row) : null;
  }

  get(id: string): LobbySession | null {
    const row = this.db.get<LobbySession>(`SELECT * FROM lobby_session WHERE id = ?`, [id]);
    return row ? this.mapSession(row) : null;
  }

  updateNavigation(id: string, updates: {
    navigation_level?: NavigationLevel;
    current_workspace_id?: string | null;
    current_issue_id?: string | null;
    current_stage_id?: string | null;
  }): LobbySession {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.navigation_level !== undefined) { sets.push("navigation_level = ?"); params.push(updates.navigation_level); }
    if (updates.current_workspace_id !== undefined) { sets.push("current_workspace_id = ?"); params.push(updates.current_workspace_id); }
    if (updates.current_issue_id !== undefined) { sets.push("current_issue_id = ?"); params.push(updates.current_issue_id); }
    if (updates.current_stage_id !== undefined) { sets.push("current_stage_id = ?"); params.push(updates.current_stage_id); }
    const now = new Date().toISOString();
    sets.push("updated_at = ?", "last_command_at = ?");
    params.push(now, now, id);
    this.db.run(`UPDATE lobby_session SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.get(id)!;
  }

  listAll(): LobbySession[] {
    return this.db.all<LobbySession>(`SELECT * FROM lobby_session ORDER BY updated_at DESC`).map(this.mapSession);
  }

  getInStageSessions(channelType: ChannelType): LobbySession[] {
    return this.db.all<LobbySession>(
      `SELECT * FROM lobby_session WHERE channel_type = ? AND navigation_level = 'in_stage' AND current_stage_id IS NOT NULL`,
      [channelType],
    ).map(this.mapSession);
  }

  addMessage(input: { lobby_session_id: string; direction: "inbound" | "outbound"; command?: string | null; content: string; response_content?: string | null }): LobbyMessage {
    const now = new Date().toISOString();
    const id = this.db.run(
      `INSERT INTO lobby_message (lobby_session_id, direction, command, content, response_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.lobby_session_id, input.direction, input.command ?? null, input.content, input.response_content ?? null, now],
    );
    return { id, lobby_session_id: input.lobby_session_id, direction: input.direction, command: input.command ?? null, content: input.content, response_content: input.response_content ?? null, created_at: now };
  }

  getMessages(sessionId: string, limit = 50, offset = 0): LobbyMessage[] {
    return this.db.all<LobbyMessage>(
      `SELECT * FROM lobby_message WHERE lobby_session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [sessionId, limit, offset],
    ).map(this.mapMessage);
  }

  private mapSession(row: LobbySession): LobbySession {
    return { ...row, channel_tenant_key: row.channel_tenant_key ?? null };
  }

  private mapMessage(row: LobbyMessage): LobbyMessage {
    return { ...row, command: row.command ?? null, response_content: row.response_content ?? null };
  }
}
