import { randomUUID } from "crypto";
import type { IMChannelConfig, LobbySession, LobbyMessage, NavigationLevel } from "@domain/im/model";

/** IM 持久层接口 */
export interface IMRepository {
  // IM 渠道配置
  listChannelConfigs(): IMChannelConfig[];
  getChannelConfig(type: string): IMChannelConfig | undefined;
  registerChannelConfig(config: IMChannelConfig): void;
}

/** IM 内存存储实现 */
export class InMemoryIMRepository implements IMRepository {
  private channelConfigs = new Map<string, IMChannelConfig>();

  listChannelConfigs(): IMChannelConfig[] {
    return [...this.channelConfigs.values()];
  }

  getChannelConfig(type: string): IMChannelConfig | undefined {
    return this.channelConfigs.get(type);
  }

  registerChannelConfig(config: IMChannelConfig): void {
    this.channelConfigs.set(config.type, config);
  }
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
  getInStageSessions(channelType: string): LobbySession[];
  addMessage(input: { lobby_session_id: string; direction: "inbound" | "outbound"; command?: string | null; content: string; response_content?: string | null }): LobbyMessage;
  getMessages(sessionId: string, limit?: number, offset?: number): LobbyMessage[];
}

/** Lobby 内存存储实现 */
export class InMemoryLobbyRepository implements LobbySessionRepository {
  private sessions = new Map<string, LobbySession>();
  private sessionsByChannel = new Map<string, string>();
  private messages: LobbyMessage[] = [];
  private nextMessageId = 1;

  getOrCreate(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession {
    const existing = this.getByChannel(channelType, channelChatId, channelTenantKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = randomUUID();
    const session: LobbySession = {
      id,
      channel_type: channelType as LobbySession["channel_type"],
      channel_chat_id: channelChatId,
      channel_tenant_key: channelTenantKey,
      navigation_level: "lobby",
      current_workspace_id: null,
      current_issue_id: null,
      current_stage_id: null,
      last_command_at: now,
      created_at: now,
      updated_at: now,
    };
    this.sessions.set(id, session);
    this.sessionsByChannel.set(this.channelKey(channelType, channelChatId, channelTenantKey), id);
    return session;
  }

  getByChannel(channelType: string, channelChatId: string, channelTenantKey: string | null): LobbySession | null {
    const id = this.sessionsByChannel.get(this.channelKey(channelType, channelChatId, channelTenantKey));
    return id ? (this.sessions.get(id) ?? null) : null;
  }

  get(id: string): LobbySession | null {
    return this.sessions.get(id) ?? null;
  }

  updateNavigation(id: string, updates: {
    navigation_level?: NavigationLevel;
    current_workspace_id?: string | null;
    current_issue_id?: string | null;
    current_stage_id?: string | null;
  }): LobbySession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Lobby session not found: ${id}`);
    if (updates.navigation_level !== undefined) session.navigation_level = updates.navigation_level;
    if (updates.current_workspace_id !== undefined) session.current_workspace_id = updates.current_workspace_id;
    if (updates.current_issue_id !== undefined) session.current_issue_id = updates.current_issue_id;
    if (updates.current_stage_id !== undefined) session.current_stage_id = updates.current_stage_id;
    const now = new Date().toISOString();
    session.updated_at = now;
    session.last_command_at = now;
    return session;
  }

  listAll(): LobbySession[] {
    return [...this.sessions.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  getInStageSessions(channelType: string): LobbySession[] {
    return [...this.sessions.values()].filter(
      s => s.channel_type === channelType && s.navigation_level === "in_stage" && s.current_stage_id !== null,
    );
  }

  addMessage(input: { lobby_session_id: string; direction: "inbound" | "outbound"; command?: string | null; content: string; response_content?: string | null }): LobbyMessage {
    const msg: LobbyMessage = {
      id: this.nextMessageId++,
      lobby_session_id: input.lobby_session_id,
      direction: input.direction,
      command: input.command ?? null,
      content: input.content,
      response_content: input.response_content ?? null,
      created_at: new Date().toISOString(),
    };
    this.messages.push(msg);
    return msg;
  }

  getMessages(sessionId: string, limit = 50, offset = 0): LobbyMessage[] {
    return this.messages
      .filter(m => m.lobby_session_id === sessionId)
      .reverse()
      .slice(offset, offset + limit);
  }

  private channelKey(channelType: string, chatId: string, tenantKey: string | null): string {
    return `${channelType}:${chatId}:${tenantKey ?? ""}`;
  }
}
