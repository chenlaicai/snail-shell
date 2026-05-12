import type Database from "better-sqlite3";
import type { MessageDispatch, MessageDispatchStatus } from "./types";

export function markProjectDispatchesConsumed(db: Database.Database, dispatchIds: number[], consumedByMessageId: number | null = null): void {
  updateProjectDispatchStatus(db, dispatchIds, "consumed", consumedByMessageId);
}

export function markProjectDispatchesSeen(db: Database.Database, dispatchIds: number[]): void {
  updateProjectDispatchStatus(db, dispatchIds, "seen");
}

export function skipProjectDispatches(db: Database.Database, dispatchIds: number[]): void {
  updateProjectDispatchStatus(db, dispatchIds, "skipped");
}

export function listProjectBossPendingDispatches(db: Database.Database, conversationId: string): MessageDispatch[] {
  return db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_snail = 'Boss Snail' AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
}

function updateProjectDispatchStatus(db: Database.Database, dispatchIds: number[], status: MessageDispatchStatus, consumedByMessageId: number | null = null): void {
  if (dispatchIds.length === 0) return;
  const placeholders = dispatchIds.map(() => "?").join(", ");
  db.prepare(`UPDATE message_dispatch SET status = ?, consumed_by_message_id = ?, consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(status, consumedByMessageId, ...dispatchIds);
}
