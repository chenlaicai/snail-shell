/**
 * SQLite Conversation Repository 实现
 *
 * 基于 better-sqlite3 实现 Conversation Repository 接口。
 */

import type { DatabaseConnection } from "../../connection/types";
import type {
  ConversationRepository,
  Message,
  MessageEvent,
  MessageContext,
  Conversation,
  MessageDispatch,
  CreateMessageInput,
  CreateMessageEventInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  MessageStatus,
} from "../../../conversation";

/**
 * SQLite Conversation Repository 实现
 */
export class SqliteConversationRepository implements ConversationRepository {
  constructor(private connection: DatabaseConnection) {}

  // ═══ Message CRUD ═══

  async getMessage(id: number): Promise<Message | null> {
    const result = await this.connection.query<Message>(
      "SELECT * FROM message WHERE id = ?",
      [id]
    );
    return result.rows[0] ?? null;
  }

  async getMessages(conversationId: string, limit?: number): Promise<Message[]> {
    const sql = limit
      ? "SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?"
      : "SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at ASC";
    const params = limit ? [conversationId, limit] : [conversationId];
    const result = await this.connection.query<Message>(sql, params);
    return result.rows;
  }

  async saveMessage(input: CreateMessageInput): Promise<Message> {
    const result = await this.connection.execute(
      `INSERT INTO message (conversation_id, client_id, from_role, to_roles, role, quoted_message_id, runtime, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.conversation_id,
        input.client_id ?? null,
        input.from_role ?? null,
        JSON.stringify(input.to_roles ?? []),
        input.role,
        input.quoted_message_id ?? null,
        input.runtime ?? null,
        input.status,
      ]
    );

    // 获取插入的消息
    const message = await this.getMessage(Number(result.lastInsertRowid));
    if (!message) {
      throw new Error("Failed to save message");
    }
    return message;
  }

  async updateMessageStatus(id: number, status: MessageStatus): Promise<void> {
    await this.connection.execute(
      "UPDATE message SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [status, id]
    );
  }

  // ═══ MessageEvent CRUD ═══

  async getMessageEvents(messageId: number): Promise<MessageEvent[]> {
    const result = await this.connection.query<MessageEvent>(
      "SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC",
      [messageId]
    );
    return result.rows;
  }

  async saveMessageEvent(input: CreateMessageEventInput): Promise<MessageEvent> {
    const result = await this.connection.execute(
      `INSERT INTO message_event (message_id, seq, category, kind, payload, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.message_id,
        input.seq,
        input.category,
        input.kind,
        JSON.stringify(input.payload),
        input.source,
      ]
    );

    // 获取插入的事件
    const event = await this.connection.query<MessageEvent>(
      "SELECT * FROM message_event WHERE id = ?",
      [Number(result.lastInsertRowid)]
    );
    if (!event.rows[0]) {
      throw new Error("Failed to save message event");
    }
    return event.rows[0];
  }

  // ═══ MessageContext CRUD ═══

  async getMessageContext(messageId: number): Promise<MessageContext | null> {
    const result = await this.connection.query<MessageContext>(
      "SELECT * FROM message_context WHERE message_id = ?",
      [messageId]
    );
    return result.rows[0] ?? null;
  }

  async saveMessageContext(context: Omit<MessageContext, "updated_at">): Promise<void> {
    await this.connection.execute(
      `INSERT OR REPLACE INTO message_context (message_id, kind, context)
       VALUES (?, ?, ?)`,
      [context.message_id, context.kind, context.context]
    );
  }

  // ═══ Conversation CRUD ═══

  async getConversation(id: string): Promise<Conversation | null> {
    const result = await this.connection.query<Conversation>(
      "SELECT * FROM conversation WHERE id = ?",
      [id]
    );
    return result.rows[0] ?? null;
  }

  async getStageConversation(stageId: string): Promise<Conversation | null> {
    const result = await this.connection.query<Conversation>(
      "SELECT * FROM conversation WHERE stage_id = ?",
      [stageId]
    );
    return result.rows[0] ?? null;
  }

  async saveConversation(input: CreateConversationInput): Promise<Conversation> {
    await this.connection.execute(
      `INSERT INTO conversation (id, workspace_id, issue_id, stage_id, owner_type, owner_id, title, kind, status, default_role, participating_roles, summary, from_conversation_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.workspace_id ?? null,
        input.issue_id ?? null,
        input.stage_id ?? null,
        input.owner_type ?? "workspace_stage",
        input.owner_id ?? null,
        input.title,
        input.kind,
        input.status ?? "active",
        input.default_role,
        JSON.stringify(input.participating_roles ?? []),
        input.summary ?? null,
        JSON.stringify(input.from_conversation_ids ?? []),
      ]
    );

    const conversation = await this.getConversation(input.id);
    if (!conversation) {
      throw new Error("Failed to save conversation");
    }
    return conversation;
  }

  // ═══ MessageDispatch CRUD ═══

  async getPendingDispatches(conversationId: string, toRole: string): Promise<MessageDispatch[]> {
    const result = await this.connection.query<MessageDispatch>(
      `SELECT * FROM message_dispatch
       WHERE conversation_id = ? AND to_role = ? AND status = 'pending'
       ORDER BY created_at ASC`,
      [conversationId, toRole]
    );
    return result.rows;
  }

  async saveMessageDispatch(input: CreateMessageDispatchInput): Promise<MessageDispatch> {
    const result = await this.connection.execute(
      `INSERT INTO message_dispatch (conversation_id, message_id, to_role, status)
       VALUES (?, ?, ?, ?)`,
      [input.conversation_id, input.message_id, input.to_role, input.status ?? "pending"]
    );

    const dispatch = await this.connection.query<MessageDispatch>(
      "SELECT * FROM message_dispatch WHERE id = ?",
      [Number(result.lastInsertRowid)]
    );
    if (!dispatch.rows[0]) {
      throw new Error("Failed to save message dispatch");
    }
    return dispatch.rows[0];
  }

  async markDispatchesConsumed(ids: number[], consumedByMessageId: number): Promise<void> {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => "?").join(",");
    await this.connection.execute(
      `UPDATE message_dispatch
       SET status = 'consumed', consumed_by_message_id = ?, consumed_at = datetime('now')
       WHERE id IN (${placeholders})`,
      [consumedByMessageId, ...ids]
    );
  }

  // ═══ 查询方法 ═══

  async getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    const result = await this.connection.query<Message>(
      `SELECT * FROM message
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [conversationId, limit]
    );
    return result.rows.reverse(); // 返回时间正序
  }

  async searchMessages(query: string): Promise<Message[]> {
    const result = await this.connection.query<Message>(
      `SELECT m.* FROM message m
       JOIN message_search ms ON m.id = ms.message_id
       WHERE ms.content MATCH ?
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [query]
    );
    return result.rows;
  }
}
