import type Database from "better-sqlite3";
import type { Message } from "@domain/message/model";

/**
 * Issue 对话历史查询适配器。
 * 从 IssueMCPPortAdapter 中提取，负责对话历史相关的查询操作。
 */
export class IssueHistoryAdapter {
  protected db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async searchHistory(params: {
    issueId?: string;
    conversationId?: string;
    query: string;
    limit?: number;
  }): Promise<{
    mode: string;
    query: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Array<{
      message_id: string;
      conversation_id: string;
      role: string;
      from_role: string | null;
      snippet: string;
    }>;
  }> {
    const convIds = await this.resolveConversationIds(params.issueId, params.conversationId);
    if (convIds.length === 0) {
      return {
        mode: "search",
        query: params.query,
        issue_id: params.issueId || null,
        context_resolved: "none",
        messages: [],
      };
    }

    const ftsQuery = this.buildFtsQuery(params.query);
    const placeholders = convIds.map(() => "?").join(",");
    const messages = this.db.prepare(
      `SELECT * FROM message_search WHERE message_search MATCH ? AND conversation_id IN (${placeholders}) ORDER BY rank LIMIT ?`
    ).all(ftsQuery, ...convIds, params.limit ?? 5) as any[];

    return {
      mode: "search",
      query: params.query,
      issue_id: params.issueId || null,
      context_resolved: params.issueId ? "issue" : "conversation",
      messages: messages.map((m) => ({
        message_id: m.message_id,
        conversation_id: m.conversation_id,
        role: m.role,
        from_role: m.from_role,
        snippet: this.normalizeSnippet(m.snippet || ""),
      })),
    };
  }

  async getRecentHistory(params: {
    issueId?: string;
    conversationId?: string;
    limit?: number;
  }): Promise<{
    mode: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Message[];
  }> {
    const convIds = await this.resolveConversationIds(params.issueId, params.conversationId);
    if (convIds.length === 0) {
      return {
        mode: "recent",
        issue_id: params.issueId || null,
        context_resolved: "none",
        messages: [],
      };
    }

    const limit = params.limit ?? 10;
    const messageIds = this.collectRecentMessageIds(convIds);

    if (messageIds.length === 0) {
      return {
        mode: "recent",
        issue_id: params.issueId || null,
        context_resolved: params.issueId ? "issue" : "conversation",
        messages: [],
      };
    }

    const messages = this.fetchMessagesByIds(messageIds);

    return {
      mode: "recent",
      issue_id: params.issueId || null,
      context_resolved: params.issueId ? "issue" : "conversation",
      messages: messages.slice(-limit).map(this.toMessageRow),
    };
  }

  async getPageHistory(params: {
    issueId?: string;
    conversationId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    mode: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Message[];
  }> {
    const convIds = await this.resolveConversationIds(params.issueId, params.conversationId);
    if (convIds.length === 0) {
      return {
        mode: "page",
        issue_id: params.issueId || null,
        context_resolved: "none",
        messages: [],
      };
    }

    const placeholders = convIds.map(() => "?").join(",");
    const messages = this.db.prepare(
      `SELECT * FROM message WHERE conversation_id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?`
    ).all(...convIds, params.limit ?? 50, params.offset ?? 0) as any[];

    return {
      mode: "page",
      issue_id: params.issueId || null,
      context_resolved: params.issueId ? "issue" : "conversation",
      messages: messages.map(this.toMessageRow),
    };
  }

  async getWindowHistory(params: {
    conversationId: string;
    anchorMessageId: number;
    before?: number;
    after?: number;
    direction?: "forward" | "backward";
  }): Promise<{
    mode: string;
    messages: Message[];
  }> {
    const msg = this.db.prepare(
      "SELECT id, created_at, conversation_id FROM message WHERE id = ? AND conversation_id = ?"
    ).get(params.anchorMessageId, params.conversationId) as any;

    if (!msg) {
      return { mode: "window", messages: [] };
    }

    const order = params.direction === "forward" ? "ASC" : "DESC";
    const compare = params.direction === "forward" ? ">" : "<";
    const before = params.before ?? 2;
    const after = params.after ?? 2;

    const beforeRows = this.db.prepare(
      `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) ${compare} datetime(?) ORDER BY datetime(created_at) ${order}, id ${order} LIMIT ?`
    ).all(params.conversationId, msg.created_at, before) as any[];

    const afterRows = this.db.prepare(
      `SELECT * FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime(?) AND id != ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ?`
    ).all(params.conversationId, msg.created_at, params.anchorMessageId, after + 1) as any[];

    return {
      mode: "window",
      messages: [...beforeRows.reverse(), ...afterRows].map(this.toMessageRow),
    };
  }

  async getHistoryByIds(params: {
    conversationId: string;
    messageIds: number[];
  }): Promise<{
    mode: string;
    messages: Message[];
  }> {
    if (!params.messageIds || params.messageIds.length === 0) {
      return { mode: "by-ids", messages: [] };
    }

    const placeholders = params.messageIds.map(() => "?").join(",");
    const messages = this.db.prepare(
      `SELECT * FROM message WHERE id IN (${placeholders}) AND conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC`
    ).all(...params.messageIds, params.conversationId) as any[];

    return {
      mode: "by-ids",
      messages: messages.map(this.toMessageRow),
    };
  }

  async reindexHistory(params: {
    conversationId?: string;
  }): Promise<{
    mode: string;
    conversation_id: string | null;
    indexed_messages: number;
  }> {
    const targetMessages = params.conversationId
      ? (this.db.prepare("SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(params.conversationId) as Array<{ id: number }>)
      : (this.db.prepare("SELECT id FROM message ORDER BY datetime(created_at) ASC, id ASC").all() as Array<{ id: number }>);

    if (params.conversationId) {
      this.db.prepare("DELETE FROM message_search WHERE conversation_id = ?").run(params.conversationId);
    } else {
      this.db.prepare("DELETE FROM message_search").run();
    }

    for (const msg of targetMessages) {
      const row = this.db.prepare("SELECT * FROM message WHERE id = ?").get(msg.id) as any;
      if (!row) continue;

      const events = this.db.prepare("SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC").all(row.id) as any[];
      const content = this.buildSearchableContent(row.role, events);
      if (!content) continue;

      this.db.prepare("DELETE FROM message_search WHERE message_id = ?").run(String(row.id));
      this.db.prepare(
        "INSERT INTO message_search (conversation_id, message_id, role, from_role, content) VALUES (?, ?, ?, ?, ?)"
      ).run(row.conversation_id, String(row.id), row.role, row.from_role, content);
    }

    return {
      mode: "reindex",
      conversation_id: params.conversationId || null,
      indexed_messages: targetMessages.length,
    };
  }

  // ── 辅助方法 ──────────────────────────────────────────

  protected async resolveConversationIds(
    issueId?: string,
    conversationId?: string
  ): Promise<string[]> {
    if (issueId) {
      return (this.db.prepare("SELECT id FROM conversation WHERE issue_id = ? ORDER BY datetime(created_at) ASC").all(issueId) as Array<{ id: string }>).map((r) => r.id);
    }
    if (conversationId) {
      return [conversationId];
    }
    return [];
  }

  private buildFtsQuery(query: string): string {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return "*";
    return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
  }

  private normalizeSnippet(snippet: string): string {
    return snippet.replace(/\s+/g, " ").trim();
  }

  private collectRecentMessageIds(convIds: string[]): number[] {
    const result: number[] = [];
    const seen = new Set<number>();

    for (const convId of convIds) {
      const userMessages = this.db.prepare(
        `SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 3`
      ).all(convId) as Array<{ id: number }>;

      for (const um of userMessages) {
        const window = this.db.prepare(
          `SELECT id FROM message WHERE conversation_id = ? AND datetime(created_at) >= datetime((SELECT created_at FROM message WHERE id = ?)) ORDER BY datetime(created_at) ASC, id ASC`
        ).all(convId, um.id) as Array<{ id: number }>;

        for (const row of window) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            result.push(row.id);
          }
        }
      }
    }

    return result;
  }

  private fetchMessagesByIds(messageIds: number[]): any[] {
    const placeholders = messageIds.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT * FROM message WHERE id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC`
    ).all(...messageIds) as any[];
  }

  private buildSearchableContent(role: string, events: any[]): string {
    const parts: string[] = [];
    for (const event of events) {
      try {
        const payload = JSON.parse(event.payload || "{}");
        if (payload.type === "text_delta" && payload.text) {
          parts.push(payload.text);
        }
      } catch (_) { /* ignore */ }
    }
    return parts.join(" ");
  }

  protected toMessageRow(row: any): Message {
    try {
      row.events = JSON.parse(row.events || "[]");
    } catch (_) {
      row.events = [];
    }
    try {
      row.metadata = JSON.parse(row.metadata || "{}");
    } catch (_) {
      row.metadata = {};
    }
    return row as Message;
  }
}
