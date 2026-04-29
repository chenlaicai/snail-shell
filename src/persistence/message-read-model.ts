import type Database from "better-sqlite3";
import { mapMessage, mapMessageEvent } from "./helpers";
import type { MessageEvent, MessageWithEvents, PersistedMessageEventRow, SnailName } from "./types";

export type ConversationEventWithMessage = MessageEvent & { message_from_snail: SnailName | null };
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
    `SELECT message_event.*, message.from_snail AS message_from_snail FROM message_event
     JOIN message ON message.id = message_event.message_id
     WHERE message.conversation_id = ? AND message_event.id > ? ${upperBound}
     ORDER BY message_event.id ASC`
  ).all(...params) as Array<PersistedMessageEventRow & { message_from_snail: SnailName | null }>;
  return rows.map((row) => ({ ...mapMessageEvent(row), message_from_snail: row.message_from_snail }));
}
