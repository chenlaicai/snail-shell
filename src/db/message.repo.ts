import type Database from 'better-sqlite3';
import type {
  Message,
  MessageRole,
  MessageStatus,
  MessageEvent,
  MessageEventCategory,
  MessageEventKind,
  MessageContext,
  MessageContextKind,
  MessageDispatch,
  DispatchStatus,
} from '@/conversation/types.js';
import type { AgentRuntime, EventSource } from '@/snail/acs/types.js';

export class MessageRepo {
  constructor(private db: Database.Database) {}

  // ─── Message ───

  getById(id: number): Message | undefined {
    const row = this.db.prepare('SELECT * FROM message WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.parseMessage(row) : undefined;
  }

  listByConversation(conversationId: string, options?: { limit?: number; before?: number }): Message[] {
    let sql = 'SELECT * FROM message WHERE conversation_id = ?';
    const params: unknown[] = [conversationId];
    if (options?.before) {
      sql += ' AND id < ?';
      params.push(options.before);
    }
    sql += ' ORDER BY created_at DESC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(row => this.parseMessage(row));
  }

  create(message: Omit<Message, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO message (conversation_id, client_id, from_role, to_roles, role, runtime, status, quoted_message_id, context_cutoff_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.conversation_id,
      message.client_id ?? null,
      message.from_role,
      JSON.stringify(message.to_roles),
      message.role,
      message.runtime,
      message.status,
      message.quoted_message_id ?? null,
      message.context_cutoff_at ?? null,
      message.created_at,
      message.updated_at,
    );
    return result.lastInsertRowid as number;
  }

  updateStatus(id: number, status: MessageStatus): void {
    this.db.prepare('UPDATE message SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
  }

  // ─── MessageEvent ───

  listEventsByMessage(messageId: number): MessageEvent[] {
    return (this.db.prepare('SELECT * FROM message_event WHERE message_id = ? ORDER BY seq').all(messageId) as Record<string, unknown>[])
      .map(row => this.parseEvent(row));
  }

  appendEvent(event: Omit<MessageEvent, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO message_event (message_id, seq, category, kind, payload, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.message_id,
      event.seq,
      event.category,
      event.kind,
      JSON.stringify(event.payload),
      event.source ? JSON.stringify(event.source) : null,
      event.created_at,
    );
    return result.lastInsertRowid as number;
  }

  // ─── MessageContext ───

  getContext(messageId: number): MessageContext | undefined {
    const row = this.db.prepare('SELECT * FROM message_context WHERE message_id = ?').get(messageId) as Record<string, unknown> | undefined;
    return row ? this.parseContext(row) : undefined;
  }

  upsertContext(ctx: MessageContext): void {
    this.db.prepare(`
      INSERT INTO message_context (message_id, kind, context, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET kind = excluded.kind, context = excluded.context, updated_at = excluded.updated_at
    `).run(ctx.message_id, ctx.kind, ctx.context, ctx.updated_at);
  }

  // ─── MessageDispatch ───

  listPendingDispatches(conversationId: string, role: string): MessageDispatch[] {
    return (this.db.prepare(
      'SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_role = ? AND status = ? ORDER BY id'
    ).all(conversationId, role, 'pending') as Record<string, unknown>[])
      .map(row => this.parseDispatch(row));
  }

  createDispatch(dispatch: Omit<MessageDispatch, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO message_dispatch (conversation_id, message_id, to_role, status, consumed_by_message_id, created_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      dispatch.conversation_id,
      dispatch.message_id,
      dispatch.to_role,
      dispatch.status,
      dispatch.consumed_by_message_id ?? null,
      dispatch.created_at,
      dispatch.consumed_at ?? null,
    );
    return result.lastInsertRowid as number;
  }

  updateDispatchStatus(id: number, status: DispatchStatus, consumedByMessageId?: number): void {
    this.db.prepare('UPDATE message_dispatch SET status = ?, consumed_by_message_id = ?, consumed_at = datetime(\'now\') WHERE id = ?')
      .run(status, consumedByMessageId ?? null, id);
  }

  // ─── 解析 ───

  private parseMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as number,
      conversation_id: row.conversation_id as string,
      client_id: row.client_id as string | undefined,
      from_role: row.from_role as string,
      to_roles: JSON.parse(row.to_roles as string),
      role: row.role as MessageRole,
      runtime: row.runtime as AgentRuntime,
      status: row.status as MessageStatus,
      quoted_message_id: row.quoted_message_id as number | undefined,
      context_cutoff_at: row.context_cutoff_at as number | undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private parseEvent(row: Record<string, unknown>): MessageEvent {
    return {
      id: row.id as number,
      message_id: row.message_id as number,
      seq: row.seq as number,
      category: row.category as MessageEventCategory,
      kind: row.kind as MessageEventKind,
      payload: JSON.parse(row.payload as string),
      source: row.source ? JSON.parse(row.source as string) as EventSource : undefined,
      created_at: row.created_at as string,
    };
  }

  private parseContext(row: Record<string, unknown>): MessageContext {
    return {
      message_id: row.message_id as number,
      kind: row.kind as MessageContextKind,
      context: row.context as string,
      updated_at: row.updated_at as string,
    };
  }

  private parseDispatch(row: Record<string, unknown>): MessageDispatch {
    return {
      id: row.id as number,
      conversation_id: row.conversation_id as string,
      message_id: row.message_id as number,
      to_role: row.to_role as string,
      status: row.status as DispatchStatus,
      consumed_by_message_id: row.consumed_by_message_id as number | undefined,
      created_at: row.created_at as string,
      consumed_at: row.consumed_at as string | undefined,
    };
  }
}
