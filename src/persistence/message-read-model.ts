import type Database from "better-sqlite3";
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import { attachMessageEvents, buildFtsQuery, mapMessage, mapMessageEvent, normalizeSnippet } from "./helpers";
import { getMessageContext } from "./message-context-model";
import type { ConversationHistorySearchResult, MessageEvent, MessageRole, MessageWithEvents, PersistedMessageEventRow, RoleName } from "../shared/types";

export type ConversationEventWithMessage = MessageEvent & { message_from_role: RoleName | null };
export interface RecentMessagesSnapshot {
  items: MessageWithEvents[];
  last_event_id: number;
}

export function getRecentMessagesSnapshot(input: { db: Database.Database; conversationId: string; limit: number; beforeCursorHook?: (snapshotEventId: number) => void }): RecentMessagesSnapshot {
  const transaction = input.db.transaction(() => {
    const snapshotEventId = getLastMessageEventId(input.db, input.conversationId);
    input.beforeCursorHook?.(snapshotEventId);
    const rows = input.db.prepare(
      `SELECT * FROM message
       WHERE conversation_id = ?
         AND (id IN (SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?)
           OR status = 'streaming')
       ORDER BY datetime(created_at) ASC, id ASC`
    ).all(input.conversationId, input.conversationId, input.limit) as Record<string, unknown>[];
    const items = rows.map(mapMessage).map((message) => ({
      ...message,
      events: getMessageEventsAtOrBefore(input.db, message.id, snapshotEventId),
      context: getMessageContext(input.db, message.id),
    }));
    return { items, last_event_id: snapshotEventId };
  });
  return transaction() as RecentMessagesSnapshot;
}

export function getLastMessageEventId(db: Database.Database, conversationId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(message_event.id), 0) AS id
     FROM message_event
     JOIN message ON message.id = message_event.message_id
     WHERE message.conversation_id = ?`
  ).get(conversationId) as { id: number } | undefined;
  return row?.id ?? 0;
}

export function getMessageEventsAtOrBefore(db: Database.Database, messageId: number, snapshotEventId: number): MessageEvent[] {
  const rows = db.prepare("SELECT * FROM message_event WHERE message_id = ? AND id <= ? ORDER BY seq ASC").all(messageId, snapshotEventId) as PersistedMessageEventRow[];
  return rows.map(mapMessageEvent);
}

export function getMessageEventsAfter(db: Database.Database, conversationId: string, afterEventId: number, untilEventId: number | null = null): ConversationEventWithMessage[] {
  const upperBound = Number.isInteger(untilEventId) ? "AND message_event.id <= ?" : "";
  const params = Number.isInteger(untilEventId) ? [conversationId, afterEventId, untilEventId] : [conversationId, afterEventId];
  const rows = db.prepare(
    `SELECT message_event.*, message.from_role AS message_from_role FROM message_event
     JOIN message ON message.id = message_event.message_id
     WHERE message.conversation_id = ? AND message_event.id > ? ${upperBound}
     ORDER BY message_event.id ASC`
  ).all(...params) as Array<PersistedMessageEventRow & { message_from_role: RoleName | null }>;
  return rows.map((row) => ({ ...mapMessageEvent(row), message_from_role: row.message_from_role }));
}

export function getRecentMessages(input: { db: Database.Database; conversationId: string; limit: number; getMessageEvents: (messageId: number) => MessageWithEvents["events"] }): MessageWithEvents[] {
  const rows = input.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?").all(input.conversationId, input.limit) as Record<string, unknown>[];
  return attachMessageEvents(rows.map(mapMessage).reverse(), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}

export function getLatestMessage(input: { db: Database.Database; conversationId: string; getMessageEvents: (messageId: number) => MessageWithEvents["events"] }): MessageWithEvents | null {
  const row = input.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(input.conversationId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return attachMessageEvents([mapMessage(row)], input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId))[0] ?? null;
}

export function getLatestRespondingRole(input: { db: Database.Database; conversationId: string; participatingRoles: RoleName[] }): RoleName | null {
  const candidates = input.participatingRoles.filter((roleName) => roleName !== HUMAN_ROLE_NAME);
  if (candidates.length === 0) return null;
  const placeholders = candidates.map(() => "?").join(", ");
  const row = input.db.prepare(
    `SELECT from_role FROM message
     WHERE conversation_id = ?
       AND role = 'assistant'
       AND from_role IS NOT NULL
       AND from_role IN (${placeholders})
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 1`
  ).get(input.conversationId, ...candidates) as { from_role: RoleName } | undefined;
  return row?.from_role ?? null;
}

export function getMessagesSinceRoleReply(input: { db: Database.Database; conversationId: string; roleName: string; getMessageEvents: (messageId: number) => MessageWithEvents["events"] }): MessageWithEvents[] {
  const lastSnailReply = input.db.prepare("SELECT id FROM message WHERE conversation_id = ? AND role = 'assistant' AND from_role = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(input.conversationId, input.roleName) as { id: number } | undefined;
  const rows = lastSnailReply
    ? input.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id > ? ORDER BY datetime(created_at) ASC, id ASC").all(input.conversationId, lastSnailReply.id) as Record<string, unknown>[]
    : input.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(input.conversationId) as Record<string, unknown>[];
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}

export function getDispatchInboxMessages(input: { db: Database.Database; conversationId: string; roleName: string; dispatchSourceMessageIds: number[]; getMessageEvents: (messageId: number) => MessageWithEvents["events"] }): MessageWithEvents[] {
  const uniqueSourceIds = [...new Set(input.dispatchSourceMessageIds.filter(Number.isInteger))];
  const sourcePlaceholders = uniqueSourceIds.map(() => "?").join(", ");
  const lastSnailReply = input.db.prepare(
    "SELECT id, context_cutoff_at FROM message WHERE conversation_id = ? AND role = 'assistant' AND from_role = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1"
  ).get(input.conversationId, input.roleName) as { id: number; context_cutoff_at: string | null } | undefined;

  const cutoff = buildDispatchInboxCutoff(lastSnailReply);
  const sourcePredicate = uniqueSourceIds.length > 0 ? ` OR id IN (${sourcePlaceholders})` : "";
  const params = [input.conversationId, ...cutoff.params, ...uniqueSourceIds];
  const rows = input.db.prepare(
    `SELECT * FROM message
     WHERE conversation_id = ?
       AND (${cutoff.predicate}${sourcePredicate})
     ORDER BY datetime(created_at) ASC, id ASC`
  ).all(...params) as Record<string, unknown>[];

  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}

function buildDispatchInboxCutoff(lastSnailReply: { id: number; context_cutoff_at: string | null } | undefined): { predicate: string; params: number[] } {
  /**
   * `context_cutoff_at` 继承了早期命名，但实际语义是目标 Snail 上次开始回复时已读到的
   * Snail Shell message id。不能用目标 Snail 自己上一条回复的 id 作为 cutoff；那条回复是在读取
   * inbox 之后才创建的，会错误吞掉并行协作中 cutoff 后、该回复前写入的新消息。
   */
  if (!lastSnailReply) return { predicate: "1 = 1", params: [] };
  const cutoffValue = lastSnailReply.context_cutoff_at ?? "";
  if (!/^\d+$/.test(cutoffValue)) {
    throw new Error(`Invalid context_cutoff_at cutoff message id for message ${lastSnailReply.id}: ${cutoffValue}`);
  }
  const cutoffMessageId = Number(cutoffValue);
  if (!Number.isSafeInteger(cutoffMessageId)) {
    throw new Error(`Unsafe context_cutoff_at cutoff message id for message ${lastSnailReply.id}: ${cutoffValue}`);
  }
  return { predicate: "(id > ? AND id != ?)", params: [cutoffMessageId, lastSnailReply.id] };
}

export function getMessagesByIds(input: { db: Database.Database; conversationId: string; messageIds: number[]; getMessageEvents: (messageId: number) => MessageWithEvents["events"] }): MessageWithEvents[] {
  if (input.messageIds.length === 0) return [];
  const placeholders = input.messageIds.map(() => "?").join(", ");
  const rows = input.db.prepare(`SELECT * FROM message WHERE conversation_id = ? AND id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC`).all(input.conversationId, ...input.messageIds) as Record<string, unknown>[];
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}

export function getMessageWindow(input: { db: Database.Database; conversationId: string; anchorMessageId: number; before: number; after: number; getMessageEvents: (messageId: number) => MessageWithEvents["events"] }): MessageWithEvents[] {
  const anchor = input.db.prepare("SELECT id FROM message WHERE conversation_id = ? AND id = ?").get(input.conversationId, input.anchorMessageId) as { id: number } | undefined;
  if (!anchor) return [];
  const rows = input.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id BETWEEN ? AND ? ORDER BY datetime(created_at) ASC, id ASC").all(input.conversationId, input.anchorMessageId - input.before, input.anchorMessageId + input.after) as Record<string, unknown>[];
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents, (messageId) => getMessageContext(input.db, messageId));
}

export function searchConversationMessages(input: { db: Database.Database; conversationId: string; query: string; limit: number; offset: number }): ConversationHistorySearchResult[] {
  const trimmedQuery = input.query.trim();
  if (!trimmedQuery) return [];
  const rows = input.db.prepare(
    `SELECT message.id as message_id, message.role as role, message.from_role as from_role, message.created_at as created_at, snippet(message_search, 4, '', '', '...', 18) as snippet
     FROM message_search JOIN message ON message.id = CAST(message_search.message_id AS INTEGER)
     WHERE message_search.conversation_id = ? AND message_search MATCH ?
     ORDER BY bm25(message_search), datetime(message.created_at) DESC, message.id DESC LIMIT ? OFFSET ?`
  ).all(input.conversationId, buildFtsQuery(trimmedQuery), input.limit, input.offset) as Array<{ message_id: number; role: MessageRole; from_role: RoleName | null; created_at: string; snippet: string }>;
  return rows.map((row) => ({ ...row, snippet: normalizeSnippet(row.snippet) }));
}
