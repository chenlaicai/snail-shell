import type Database from "better-sqlite3";
import { attachMessageEvents, mapMessage, mapMessageEvent } from "./helpers";
import type { MessageEvent, MessageWithEvents, PersistedMessageEventRow, SnailName } from "./types";

export type ConversationEventWithMessage = MessageEvent & { message_from_snail: SnailName | null };

export function getRecentMessagesIncludingActive(input: { db: Database.Database; conversationId: string; limit: number; getMessageEvents: (messageId: number) => MessageWithEvents["events"] }): MessageWithEvents[] {
  const rows = input.db.prepare(
    `SELECT * FROM message
     WHERE conversation_id = ?
       AND (id IN (SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?)
         OR status = 'streaming')
     ORDER BY datetime(created_at) ASC, id ASC`
  ).all(input.conversationId, input.conversationId, input.limit) as Record<string, unknown>[];
  return attachMessageEvents(rows.map(mapMessage), input.getMessageEvents);
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

export function getMessageEventsAfter(db: Database.Database, conversationId: string, afterEventId: number): ConversationEventWithMessage[] {
  const rows = db.prepare(
    `SELECT message_event.*, message.from_snail AS message_from_snail FROM message_event
     JOIN message ON message.id = message_event.message_id
     WHERE message.conversation_id = ? AND message_event.id > ?
     ORDER BY message_event.id ASC`
  ).all(conversationId, afterEventId) as Array<PersistedMessageEventRow & { message_from_snail: SnailName | null }>;
  return rows.map((row) => ({ ...mapMessageEvent(row), message_from_snail: row.message_from_snail }));
}
