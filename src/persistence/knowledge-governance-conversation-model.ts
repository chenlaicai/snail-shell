import type Database from "better-sqlite3";
import {
  attachMessageEvents,
  defaultEventSource,
  eventCategoryForKind,
  mapConversation,
  mapKnowledgeGovernanceConversation,
  mapMessage,
  mapMessageContext,
  mapMessageEvent,
  serializeMessageEventPayload,
  serializeMessageEventSource,
} from "./helpers";
import type {
  ConversationHistorySearchResult,
  Conversation,
  ConversationKind,
  CreateMessageEventInput,
  CreateMessageInput,
  DispatchInboxGroup,
  Message,
  MessageContext,
  MessageContextKind,
  MessageDispatch,
  MessageEvent,
  MessageStatus,
  MessageWithEvents,
  PersistedMessageEventRow,
  SnailName,
} from "./types";
import type { KnowledgeGovernanceConversation } from "./knowledge-types";
import type { ConversationEventWithMessage, RecentMessagesSnapshot } from "./message-read-model";

const GOVERNANCE_MESSAGE_ID_OFFSET = 1_000_000_000;
const GOVERNANCE_EVENT_ID_OFFSET = 2_000_000_000;
const GOVERNANCE_DISPATCH_ID_OFFSET = 3_000_000_000;

export function toKnowledgeGovernanceMessageId(externalId: number): number {
  if (!isKnowledgeGovernanceMessageId(externalId)) throw new Error(`Invalid knowledge governance message id: ${externalId}`);
  return Math.abs(externalId) - GOVERNANCE_MESSAGE_ID_OFFSET;
}

export function fromKnowledgeGovernanceMessageId(internalId: number): number {
  return -(GOVERNANCE_MESSAGE_ID_OFFSET + internalId);
}

export function isKnowledgeGovernanceMessageId(messageId: number): boolean {
  return Number.isInteger(messageId) && messageId <= -GOVERNANCE_MESSAGE_ID_OFFSET;
}

function toKnowledgeGovernanceEventId(externalId: number): number {
  if (!Number.isInteger(externalId)) return 0;
  if (externalId >= 0) return 0;
  if (externalId > -GOVERNANCE_EVENT_ID_OFFSET) return 0;
  return Math.abs(externalId) - GOVERNANCE_EVENT_ID_OFFSET;
}

function fromKnowledgeGovernanceEventId(internalId: number): number {
  return -(GOVERNANCE_EVENT_ID_OFFSET + internalId);
}

export function toKnowledgeGovernanceDispatchId(externalId: number): number {
  if (!isKnowledgeGovernanceDispatchId(externalId)) throw new Error(`Invalid knowledge governance dispatch id: ${externalId}`);
  return Math.abs(externalId) - GOVERNANCE_DISPATCH_ID_OFFSET;
}

function fromKnowledgeGovernanceDispatchId(internalId: number): number {
  return -(GOVERNANCE_DISPATCH_ID_OFFSET + internalId);
}

export function isKnowledgeGovernanceDispatchId(dispatchId: number): boolean {
  return Number.isInteger(dispatchId) && dispatchId <= -GOVERNANCE_DISPATCH_ID_OFFSET;
}

export function knowledgeGovernanceConversationExists(db: Database.Database, conversationId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM knowledge_governance_conversation WHERE id = ?").get(conversationId));
}

export function createConversation(db: Database.Database, input: { id: string; governanceId: string; title: string; kind: ConversationKind; defaultSnail: SnailName; participatingSnails: SnailName[]; summary?: string | null; fromConversationIds?: string[] }): KnowledgeGovernanceConversation {
  db.prepare("INSERT INTO knowledge_governance_conversation (id, governance_id, title, kind, status, default_snail, participating_snails, summary, from_conversation_ids, runtime_sessions) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)").run(input.id, input.governanceId, input.title, input.kind, input.defaultSnail, JSON.stringify(input.participatingSnails), input.summary ?? null, JSON.stringify(input.fromConversationIds ?? []), JSON.stringify({}));
  return getKnowledgeGovernanceConversation(db, input.id)!;
}

export function getKnowledgeGovernanceConversation(db: Database.Database, conversationId: string): KnowledgeGovernanceConversation | null {
  const row = db.prepare("SELECT id, title, status, default_snail, participating_snails, summary, created_at, updated_at FROM knowledge_governance_conversation WHERE id = ?").get(conversationId) as Record<string, unknown> | undefined;
  return row ? mapKnowledgeGovernanceConversation(row) : null;
}

export function getConversation(db: Database.Database, conversationId: string): Conversation | null {
  const row = db.prepare("SELECT * FROM knowledge_governance_conversation WHERE id = ?").get(conversationId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapConversation({ ...row, project_id: null, feature_id: null, stage_id: null, owner_type: "knowledge_governance", owner_id: row.governance_id });
}

export function getConversationByGovernanceId(db: Database.Database, governanceId: string): KnowledgeGovernanceConversation | null {
  const row = db.prepare("SELECT id, title, status, default_snail, participating_snails, summary, created_at, updated_at FROM knowledge_governance_conversation WHERE governance_id = ? ORDER BY datetime(created_at) ASC, rowid ASC LIMIT 1").get(governanceId) as Record<string, unknown> | undefined;
  return row ? mapKnowledgeGovernanceConversation(row) : null;
}

export function updateConversationRuntimeSessions(db: Database.Database, conversationId: string, runtimeSessions: Conversation["runtime_sessions"]): void {
  db.prepare("UPDATE knowledge_governance_conversation SET runtime_sessions = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(runtimeSessions), conversationId);
}

export function addMessage(db: Database.Database, input: CreateMessageInput): Message {
  const internalQuotedId = input.quotedMessageId && isKnowledgeGovernanceMessageId(input.quotedMessageId) ? toKnowledgeGovernanceMessageId(input.quotedMessageId) : null;
  const transaction = db.transaction((payload: CreateMessageInput) => {
    const nextId = ((db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM knowledge_governance_message").get() as { id: number }).id);
    db.prepare("INSERT INTO knowledge_governance_message (id, conversation_id, client_id, from_snail, to_snails, role, quoted_message_id, context_cutoff_at, runtime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(nextId, payload.conversationId, payload.clientId ?? null, payload.fromSnail, JSON.stringify(payload.toSnails ?? []), payload.role, internalQuotedId, payload.contextCutoffAt ?? "0", payload.runtime ?? null, payload.status ?? (payload.role === "assistant" ? "streaming" : "completed"));
    for (const toSnail of payload.toSnails ?? []) {
      db.prepare("INSERT INTO knowledge_governance_message_dispatch (conversation_id, message_id, to_snail) VALUES (?, ?, ?)").run(payload.conversationId, nextId, toSnail);
    }
    db.prepare("UPDATE knowledge_governance_conversation SET updated_at = datetime('now') WHERE id = ?").run(payload.conversationId);
    return nextId;
  });
  return mapGovernanceMessage(db, transaction(input) as number)!;
}

export function addMessageEvent(db: Database.Database, externalMessageId: number, event: CreateMessageEventInput): MessageEvent {
  const messageId = toKnowledgeGovernanceMessageId(externalMessageId);
  const message = getMessage(db, externalMessageId);
  if (!message) throw new Error(`Message not found: ${externalMessageId}`);
  if (message.status !== "streaming") throw new Error(`Cannot append event to terminal message ${externalMessageId}`);
  const transaction = db.transaction(() => {
    const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM knowledge_governance_message_event WHERE message_id = ?").get(messageId) as { seq: number }).seq;
    if (seq === 1 && event.kind !== "start") throw new Error(`first event must be start for message ${externalMessageId}`);
    if (seq !== 1 && event.kind === "start") throw new Error(`start event must be the first event for message ${externalMessageId}`);
    db.prepare("INSERT INTO knowledge_governance_message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)").run(messageId, seq, eventCategoryForKind(event.kind), event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(defaultEventSource(event.source)));
    return (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  });
  return fromEventRow(db.prepare("SELECT * FROM knowledge_governance_message_event WHERE id = ?").get(transaction() as number) as PersistedMessageEventRow);
}

export function completeMessageWithEvent(db: Database.Database, externalMessageId: number, event: CreateMessageEventInput, status: Exclude<MessageStatus, "streaming">): MessageEvent {
  const messageId = toKnowledgeGovernanceMessageId(externalMessageId);
  const transaction = db.transaction(() => {
    const message = getMessage(db, externalMessageId);
    if (!message) throw new Error(`Message not found: ${externalMessageId}`);
    if (message.status !== "streaming") throw new Error(`Cannot complete terminal message ${externalMessageId}`);
    const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM knowledge_governance_message_event WHERE message_id = ?").get(messageId) as { seq: number }).seq;
    if (seq === 1) throw new Error(`Cannot complete message ${externalMessageId} before start event`);
    db.prepare("INSERT INTO knowledge_governance_message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)").run(messageId, seq, eventCategoryForKind(event.kind), event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(defaultEventSource(event.source)));
    const id = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
    db.prepare("UPDATE knowledge_governance_message SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, messageId);
    return id;
  });
  return fromEventRow(db.prepare("SELECT * FROM knowledge_governance_message_event WHERE id = ?").get(transaction() as number) as PersistedMessageEventRow);
}

export function getMessage(db: Database.Database, externalMessageId: number, conversationId?: string): Message | null {
  const internalId = toKnowledgeGovernanceMessageId(externalMessageId);
  return mapGovernanceMessage(db, internalId, conversationId);
}

export function getMessages(db: Database.Database, conversationId: string, limit = 100, offset = 0): MessageWithEvents[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?").all(conversationId, limit, offset) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getRecentMessages(db: Database.Database, conversationId: string, limit = 5): MessageWithEvents[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?").all(conversationId, limit) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows.reverse());
}

export function getLatestMessageFromSnails(db: Database.Database, conversationId: string, snailNames: SnailName[]): MessageWithEvents | null {
  if (snailNames.length === 0) return null;
  const row = db.prepare(`SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND from_snail IN (${snailNames.map(() => "?").join(", ")}) ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`).get(conversationId, ...snailNames) as Record<string, unknown> | undefined;
  return row ? attachGovernanceMessageEvents(db, [row])[0] ?? null : null;
}

export function getRecentConversationMessagesWindow(db: Database.Database, conversationId: string, userMessageCount = 3): MessageWithEvents[] {
  const anchorRow = db.prepare("SELECT id FROM knowledge_governance_message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 1 OFFSET ?").get(conversationId, Math.max(0, userMessageCount - 1)) as { id: number } | undefined;
  if (!anchorRow) return getMessages(db, conversationId);
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id >= ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorRow.id) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getMessageEvents(db: Database.Database, externalMessageId: number): MessageEvent[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message_event WHERE message_id = ? ORDER BY seq ASC").all(toKnowledgeGovernanceMessageId(externalMessageId)) as PersistedMessageEventRow[];
  return rows.map(fromEventRow);
}

export function getRecentMessagesSnapshot(db: Database.Database, conversationId: string, limit: number, beforeCursorHook?: (snapshotEventId: number) => void): RecentMessagesSnapshot {
  const transaction = db.transaction(() => {
    const snapshotInternalEventId = getLastInternalMessageEventId(db, conversationId);
    const snapshotEventId = snapshotInternalEventId > 0 ? fromKnowledgeGovernanceEventId(snapshotInternalEventId) : 0;
    beforeCursorHook?.(snapshotEventId);
    const rows = db.prepare(`SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND (id IN (SELECT id FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?) OR status = 'streaming') ORDER BY datetime(created_at) ASC, id ASC`).all(conversationId, conversationId, limit) as Record<string, unknown>[];
    const items = attachGovernanceMessageEventsAtOrBefore(db, rows, snapshotInternalEventId);
    return { items, last_event_id: snapshotEventId };
  });
  return transaction() as RecentMessagesSnapshot;
}

export function getLastMessageEventId(db: Database.Database, conversationId: string): number {
  const id = getLastInternalMessageEventId(db, conversationId);
  return id > 0 ? fromKnowledgeGovernanceEventId(id) : 0;
}

function getLastInternalMessageEventId(db: Database.Database, conversationId: string): number {
  const row = db.prepare(`SELECT COALESCE(MAX(knowledge_governance_message_event.id), 0) AS id FROM knowledge_governance_message_event JOIN knowledge_governance_message ON knowledge_governance_message.id = knowledge_governance_message_event.message_id WHERE knowledge_governance_message.conversation_id = ?`).get(conversationId) as { id: number } | undefined;
  return row?.id ?? 0;
}

export function getMessageEventsAfter(db: Database.Database, conversationId: string, afterEventId: number, untilEventId: number | null = null): ConversationEventWithMessage[] {
  /**
   * Governance events live in a dedicated table whose autoincrement ids restart at 1.
   * The public realtime cursor is shared by conversation APIs, so governance cursors
   * must be decoded from their external namespace and foreign positive project cursors
   * must not filter out the governance stream.
   */
  const afterInternalEventId = toKnowledgeGovernanceEventId(afterEventId);
  const untilInternalEventId = typeof untilEventId === "number" && Number.isInteger(untilEventId) ? toKnowledgeGovernanceEventId(untilEventId) : 0;
  const rows = untilInternalEventId > 0
    ? db.prepare(`SELECT knowledge_governance_message_event.*, knowledge_governance_message.from_snail AS message_from_snail FROM knowledge_governance_message_event JOIN knowledge_governance_message ON knowledge_governance_message.id = knowledge_governance_message_event.message_id WHERE knowledge_governance_message.conversation_id = ? AND knowledge_governance_message_event.id > ? AND knowledge_governance_message_event.id <= ? ORDER BY knowledge_governance_message_event.id ASC`).all(conversationId, afterInternalEventId, untilInternalEventId) as Array<PersistedMessageEventRow & { message_from_snail: SnailName | null }>
    : db.prepare(`SELECT knowledge_governance_message_event.*, knowledge_governance_message.from_snail AS message_from_snail FROM knowledge_governance_message_event JOIN knowledge_governance_message ON knowledge_governance_message.id = knowledge_governance_message_event.message_id WHERE knowledge_governance_message.conversation_id = ? AND knowledge_governance_message_event.id > ? ORDER BY knowledge_governance_message_event.id ASC`).all(conversationId, afterInternalEventId) as Array<PersistedMessageEventRow & { message_from_snail: SnailName | null }>;
  return rows.map((row) => ({ ...fromEventRow(row), message_from_snail: row.message_from_snail }));
}

export function getMessagesByIds(db: Database.Database, conversationId: string, externalMessageIds: number[]): MessageWithEvents[] {
  const messageIds = externalMessageIds.filter(isKnowledgeGovernanceMessageId).map(toKnowledgeGovernanceMessageId);
  if (!messageIds.length) return [];
  const rows = db.prepare(`SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id IN (${messageIds.map(() => "?").join(", ")}) ORDER BY datetime(created_at) ASC, id ASC`).all(conversationId, ...messageIds) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getMessageWindow(input: { db: Database.Database; conversationId: string; anchorMessageId: number; before?: number; after?: number }): MessageWithEvents[] {
  const { db, conversationId, anchorMessageId: externalAnchorMessageId, before = 2, after = 2 } = input;
  if (!isKnowledgeGovernanceMessageId(externalAnchorMessageId)) return [];
  const anchorMessageId = toKnowledgeGovernanceMessageId(externalAnchorMessageId);
  const anchor = db.prepare("SELECT id FROM knowledge_governance_message WHERE conversation_id = ? AND id = ?").get(conversationId, anchorMessageId) as { id: number } | undefined;
  if (!anchor) return [];
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id BETWEEN ? AND ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorMessageId - before, anchorMessageId + after) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function searchConversationMessages(_input: { db: Database.Database; conversationId: string; query: string; limit?: number; offset?: number }): ConversationHistorySearchResult[] {
  return [];
}

export function upsertMessageContext(db: Database.Database, externalMessageId: number, kind: MessageContextKind, context: string): MessageContext {
  db.prepare("INSERT INTO knowledge_governance_message_context (message_id, kind, context, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(message_id) DO UPDATE SET kind = excluded.kind, context = excluded.context, updated_at = datetime('now')").run(toKnowledgeGovernanceMessageId(externalMessageId), kind, context);
  return getMessageContext(db, externalMessageId)!;
}

export function getMessageContext(db: Database.Database, externalMessageId: number): MessageContext | null {
  const row = db.prepare("SELECT * FROM knowledge_governance_message_context WHERE message_id = ?").get(toKnowledgeGovernanceMessageId(externalMessageId)) as Record<string, unknown> | undefined;
  return row ? mapMessageContext({ ...row, message_id: externalMessageId }) : null;
}

export function listPendingDispatches(db: Database.Database, conversationId: string, toSnail?: SnailName): MessageDispatch[] {
  const sql = toSnail ? "SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? AND to_snail = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC" : "SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC";
  const params = toSnail ? [conversationId, toSnail] : [conversationId];
  return (db.prepare(sql).all(...params) as MessageDispatch[]).map(fromDispatchRow);
}

export function listDispatches(db: Database.Database, conversationId: string): MessageDispatch[] {
  return (db.prepare("SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[]).map(fromDispatchRow);
}

export function listDispatchInboxGroups(db: Database.Database, conversationId: string): DispatchInboxGroup[] {
  const rows = db.prepare(`SELECT to_snail, status, GROUP_CONCAT(id) as dispatch_ids, GROUP_CONCAT(message_id) as message_ids, MAX(created_at) as latest_dispatch_at FROM knowledge_governance_message_dispatch WHERE conversation_id = ? GROUP BY to_snail, status ORDER BY datetime(latest_dispatch_at) ASC, to_snail ASC`).all(conversationId) as Array<{ to_snail: SnailName; status: "pending" | "seen" | "consumed" | "skipped"; dispatch_ids: string; message_ids: string; latest_dispatch_at: string }>;
  return rows.map((row) => ({ to_snail: row.to_snail, status: row.status, dispatch_ids: row.dispatch_ids.split(",").map((id) => fromKnowledgeGovernanceDispatchId(Number(id))).filter(Number.isInteger), message_ids: row.message_ids.split(",").map((id) => fromKnowledgeGovernanceMessageId(Number(id))).filter(Number.isInteger), latest_dispatch_at: row.latest_dispatch_at }));
}

export function markDispatchesConsumed(db: Database.Database, dispatchIds: number[], consumedByMessageId: number | null = null): void {
  if (!dispatchIds.length) return;
  const internalDispatchIds = dispatchIds.filter(isKnowledgeGovernanceDispatchId).map(toKnowledgeGovernanceDispatchId);
  if (!internalDispatchIds.length) return;
  const placeholders = internalDispatchIds.map(() => "?").join(", ");
  const consumedBy = consumedByMessageId && isKnowledgeGovernanceMessageId(consumedByMessageId) ? toKnowledgeGovernanceMessageId(consumedByMessageId) : null;
  db.prepare(`UPDATE knowledge_governance_message_dispatch SET status = 'consumed', consumed_by_message_id = ?, consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(consumedBy, ...internalDispatchIds);
}

export function markDispatchesSeen(db: Database.Database, dispatchIds: number[]): void {
  updateDispatchStatus(db, dispatchIds, "seen");
}

export function skipDispatches(db: Database.Database, dispatchIds: number[]): void {
  updateDispatchStatus(db, dispatchIds, "skipped");
}

export function listBossPendingDispatches(db: Database.Database, conversationId: string): MessageDispatch[] {
  return (db.prepare("SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? AND to_snail = 'Boss Snail' AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[]).map(fromDispatchRow);
}

export function updateMessageRouting(db: Database.Database, externalMessageId: number, toSnails: SnailName[]): void {
  const message = getMessage(db, externalMessageId);
  if (!message) return;
  const internalId = toKnowledgeGovernanceMessageId(externalMessageId);
  db.prepare("UPDATE knowledge_governance_message SET to_snails = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(toSnails), internalId);
  db.prepare("DELETE FROM knowledge_governance_message_dispatch WHERE message_id = ?").run(internalId);
  for (const toSnail of toSnails) db.prepare("INSERT INTO knowledge_governance_message_dispatch (conversation_id, message_id, to_snail) VALUES (?, ?, ?)").run(message.conversation_id, internalId, toSnail);
}

export function getDispatchInboxMessages(db: Database.Database, conversationId: string, snailName: string, dispatchSourceMessageIds: number[]): MessageWithEvents[] {
  const sourceIds = dispatchSourceMessageIds.filter(isKnowledgeGovernanceMessageId).map(toKnowledgeGovernanceMessageId);
  const sourcePlaceholders = sourceIds.map(() => "?").join(", ");
  const lastReply = db.prepare("SELECT id, context_cutoff_at FROM knowledge_governance_message WHERE conversation_id = ? AND role = 'assistant' AND from_snail = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(conversationId, snailName) as { id: number; context_cutoff_at: string | null } | undefined;
  const cutoff = buildInboxCutoff(lastReply);
  const sourcePredicate = sourceIds.length > 0 ? ` OR id IN (${sourcePlaceholders})` : "";
  const rows = db.prepare(`SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND (${cutoff.predicate}${sourcePredicate}) ORDER BY datetime(created_at) ASC, id ASC`).all(conversationId, ...cutoff.params, ...sourceIds) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getMessagesSinceSnailReply(db: Database.Database, conversationId: string, snailName: string): MessageWithEvents[] {
  const lastSnailReply = db.prepare("SELECT id FROM knowledge_governance_message WHERE conversation_id = ? AND role = 'assistant' AND from_snail = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(conversationId, snailName) as { id: number } | undefined;
  const rows = lastSnailReply
    ? db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id > ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, lastSnailReply.id) as Record<string, unknown>[]
    : db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

function updateDispatchStatus(db: Database.Database, dispatchIds: number[], status: "seen" | "skipped"): void {
  if (!dispatchIds.length) return;
  const internalDispatchIds = dispatchIds.filter(isKnowledgeGovernanceDispatchId).map(toKnowledgeGovernanceDispatchId);
  if (!internalDispatchIds.length) return;
  db.prepare(`UPDATE knowledge_governance_message_dispatch SET status = ?, consumed_at = datetime('now') WHERE id IN (${internalDispatchIds.map(() => "?").join(", ")})`).run(status, ...internalDispatchIds);
}

function buildInboxCutoff(lastReply: { id: number; context_cutoff_at: string | null } | undefined): { predicate: string; params: number[] } {
  if (!lastReply) return { predicate: "1 = 1", params: [] };
  const cutoffValue = lastReply.context_cutoff_at ?? "";
  if (!/^-?\d+$/.test(cutoffValue)) throw new Error(`Invalid context_cutoff_at cutoff message id for message ${lastReply.id}: ${cutoffValue}`);
  const cutoffMessageId = Number(cutoffValue);
  if (cutoffMessageId === 0) return { predicate: "id != ?", params: [lastReply.id] };
  if (!isKnowledgeGovernanceMessageId(cutoffMessageId)) throw new Error(`Invalid knowledge governance context_cutoff_at message id for message ${lastReply.id}: ${cutoffValue}`);
  return { predicate: "(id > ? AND id != ?)", params: [toKnowledgeGovernanceMessageId(cutoffMessageId), lastReply.id] };
}

function mapGovernanceMessage(db: Database.Database, internalId: number, conversationId?: string): Message | null {
  const sql = conversationId ? "SELECT * FROM knowledge_governance_message WHERE id = ? AND conversation_id = ?" : "SELECT * FROM knowledge_governance_message WHERE id = ?";
  const params = conversationId ? [internalId, conversationId] : [internalId];
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  return row ? fromMessageRow(row) : null;
}

function attachGovernanceMessageEvents(db: Database.Database, rows: Record<string, unknown>[]): MessageWithEvents[] {
  return attachMessageEvents(rows.map(fromMessageRow), (messageId) => getMessageEvents(db, messageId), (messageId) => getMessageContext(db, messageId));
}

function attachGovernanceMessageEventsAtOrBefore(db: Database.Database, rows: Record<string, unknown>[], snapshotEventId: number): MessageWithEvents[] {
  return attachMessageEvents(rows.map(fromMessageRow), (messageId) => getMessageEventsAtOrBefore(db, messageId, snapshotEventId), (messageId) => getMessageContext(db, messageId));
}

function getMessageEventsAtOrBefore(db: Database.Database, externalMessageId: number, snapshotEventId: number): MessageEvent[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message_event WHERE message_id = ? AND id <= ? ORDER BY seq ASC").all(toKnowledgeGovernanceMessageId(externalMessageId), snapshotEventId) as PersistedMessageEventRow[];
  return rows.map(fromEventRow);
}

function fromMessageRow(row: Record<string, unknown>): Message {
  return mapMessage({ ...row, id: fromKnowledgeGovernanceMessageId(Number(row.id)), quoted_message_id: row.quoted_message_id ? fromKnowledgeGovernanceMessageId(Number(row.quoted_message_id)) : null });
}

function fromDispatchRow(row: MessageDispatch): MessageDispatch {
  return { ...row, id: fromKnowledgeGovernanceDispatchId(row.id), message_id: fromKnowledgeGovernanceMessageId(row.message_id), consumed_by_message_id: row.consumed_by_message_id ? fromKnowledgeGovernanceMessageId(row.consumed_by_message_id) : null };
}

function fromEventRow(row: PersistedMessageEventRow): MessageEvent {
  return { ...mapMessageEvent(row), id: fromKnowledgeGovernanceEventId(row.id), message_id: fromKnowledgeGovernanceMessageId(row.message_id) } as MessageEvent;
}
