import type Database from "better-sqlite3";
import { mapMessageContext } from "./helpers";
import type { MessageContext, MessageContextKind } from "../shared/types";

export function upsertMessageContext(input: { db: Database.Database; messageId: number; kind: MessageContextKind; context: string }): MessageContext {
  input.db.prepare(
    `INSERT INTO message_context (message_id, kind, context, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(message_id) DO UPDATE SET kind = excluded.kind, context = excluded.context, updated_at = datetime('now')`
  ).run(input.messageId, input.kind, input.context);
  return getMessageContext(input.db, input.messageId)!;
}

export function getMessageContext(db: Database.Database, messageId: number): MessageContext | null {
  const row = db.prepare("SELECT * FROM message_context WHERE message_id = ?").get(messageId) as Record<string, unknown> | undefined;
  return row ? mapMessageContext(row) : null;
}
