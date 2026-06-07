import type Database from "better-sqlite3";
import type { MessageDispatch, MessageDispatchStatus } from "../shared/types";

export function markWorkspaceDispatchesConsumed(db: Database.Database, dispatchIds: number[], consumedByMessageId: number | null = null): void {
  updateWorkspaceDispatchStatus(db, dispatchIds, "consumed", consumedByMessageId);
}

export function markWorkspaceDispatchesSeen(db: Database.Database, dispatchIds: number[]): void {
  updateWorkspaceDispatchStatus(db, dispatchIds, "seen");
}

export function skipWorkspaceDispatches(db: Database.Database, dispatchIds: number[]): void {
  updateWorkspaceDispatchStatus(db, dispatchIds, "skipped");
}

export function listWorkspaceBossPendingDispatches(db: Database.Database, conversationId: string): MessageDispatch[] {
  return db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_role = '项目负责人' AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
}

function updateWorkspaceDispatchStatus(db: Database.Database, dispatchIds: number[], status: MessageDispatchStatus, consumedByMessageId: number | null = null): void {
  if (dispatchIds.length === 0) return;
  const placeholders = dispatchIds.map(() => "?").join(", ");
  db.prepare(`UPDATE message_dispatch SET status = ?, consumed_by_message_id = ?, consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(status, consumedByMessageId, ...dispatchIds);
}
