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
  RoleName,
} from "./types";
import type { KnowledgeGovernanceConversation } from "./knowledge-types";
import type { ConversationEventWithMessage, RecentMessagesSnapshot } from "./message-read-model";

function assertLocalId(id: number, label: string): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid knowledge governance ${label} id: ${id}`);
  return id;
}

export function knowledgeGovernanceConversationExists(db: Database.Database, conversationId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM knowledge_governance_conversation WHERE id = ?").get(conversationId));
}

export function createConversation(db: Database.Database, input: { id: string; governanceId: string; title: string; kind: ConversationKind; defaultRole: RoleName; participatingRoles: RoleName[]; summary?: string | null; fromConversationIds?: string[] }): KnowledgeGovernanceConversation {
  db.prepare("INSERT INTO knowledge_governance_conversation (id, governance_id, title, kind, status, default_role, participating_roles, summary, from_conversation_ids, runtime_sessions) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)").run(input.id, input.governanceId, input.title, input.kind, input.defaultRole, JSON.stringify(input.participatingRoles), input.summary ?? null, JSON.stringify(input.fromConversationIds ?? []), JSON.stringify({}));
  return getKnowledgeGovernanceConversation(db, input.id)!;
}

export function getKnowledgeGovernanceConversation(db: Database.Database, conversationId: string): KnowledgeGovernanceConversation | null {
  const row = db.prepare("SELECT id, title, status, default_role, participating_roles, summary, created_at, updated_at FROM knowledge_governance_conversation WHERE id = ?").get(conversationId) as Record<string, unknown> | undefined;
  return row ? mapKnowledgeGovernanceConversation(row) : null;
}

export function getConversation(db: Database.Database, conversationId: string): Conversation | null {
  const row = db.prepare("SELECT * FROM knowledge_governance_conversation WHERE id = ?").get(conversationId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapConversation({ ...row, project_id: null, feature_id: null, stage_id: null, owner_type: "knowledge_governance", owner_id: row.governance_id });
}

export function getConversationByGovernanceId(db: Database.Database, governanceId: string): KnowledgeGovernanceConversation | null {
  const row = db.prepare("SELECT id, title, status, default_role, participating_roles, summary, created_at, updated_at FROM knowledge_governance_conversation WHERE governance_id = ? ORDER BY datetime(created_at) ASC, rowid ASC LIMIT 1").get(governanceId) as Record<string, unknown> | undefined;
  return row ? mapKnowledgeGovernanceConversation(row) : null;
}

export function updateConversationRuntimeSessions(db: Database.Database, conversationId: string, runtimeSessions: Conversation["runtime_sessions"]): void {
  db.prepare("UPDATE knowledge_governance_conversation SET runtime_sessions = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(runtimeSessions), conversationId);
}

export function addMessage(db: Database.Database, input: CreateMessageInput): Message {
  const quotedMessageId = input.quotedMessageId ? assertLocalId(input.quotedMessageId, "quoted message") : null;
  const transaction = db.transaction((payload: CreateMessageInput) => {
    const nextId = ((db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM knowledge_governance_message").get() as { id: number }).id);
    db.prepare("INSERT INTO knowledge_governance_message (id, conversation_id, client_id, from_role, to_roles, role, quoted_message_id, context_cutoff_at, runtime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(nextId, payload.conversationId, payload.clientId ?? null, payload.fromRole, JSON.stringify(payload.toRoles ?? []), payload.role, quotedMessageId, payload.contextCutoffAt ?? "0", payload.runtime ?? null, payload.status ?? (payload.role === "assistant" ? "streaming" : "completed"));
    for (const toRole of payload.toRoles ?? []) {
      db.prepare("INSERT INTO knowledge_governance_message_dispatch (conversation_id, message_id, to_role) VALUES (?, ?, ?)").run(payload.conversationId, nextId, toRole);
    }
    db.prepare("UPDATE knowledge_governance_conversation SET updated_at = datetime('now') WHERE id = ?").run(payload.conversationId);
    return nextId;
  });
  return mapGovernanceMessage(db, transaction(input) as number)!;
}

export function addMessageEvent(db: Database.Database, messageId: number, event: CreateMessageEventInput, conversationId?: string): MessageEvent {
  const localMessageId = assertLocalId(messageId, "message");
  const message = getMessage(db, localMessageId, conversationId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  if (message.status !== "streaming") throw new Error(`Cannot append event to terminal message ${messageId}`);
  const transaction = db.transaction(() => {
    const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM knowledge_governance_message_event WHERE message_id = ?").get(localMessageId) as { seq: number }).seq;
    if (seq === 1 && event.kind !== "start") throw new Error(`first event must be start for message ${messageId}`);
    if (seq !== 1 && event.kind === "start") throw new Error(`start event must be the first event for message ${messageId}`);
    db.prepare("INSERT INTO knowledge_governance_message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)").run(localMessageId, seq, eventCategoryForKind(event.kind), event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(defaultEventSource(event.source)));
    return (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  });
  return fromEventRow(db.prepare("SELECT * FROM knowledge_governance_message_event WHERE id = ?").get(transaction() as number) as PersistedMessageEventRow);
}

export function completeMessageWithEvent(db: Database.Database, input: { messageId: number; event: CreateMessageEventInput; status: Exclude<MessageStatus, "streaming">; conversationId?: string }): MessageEvent {
  const { messageId, event, status, conversationId } = input;
  const localMessageId = assertLocalId(messageId, "message");
  const transaction = db.transaction(() => {
    const message = getMessage(db, localMessageId, conversationId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.status !== "streaming") throw new Error(`Cannot complete terminal message ${messageId}`);
    const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM knowledge_governance_message_event WHERE message_id = ?").get(localMessageId) as { seq: number }).seq;
    if (seq === 1) throw new Error(`Cannot complete message ${messageId} before start event`);
    db.prepare("INSERT INTO knowledge_governance_message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)").run(localMessageId, seq, eventCategoryForKind(event.kind), event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(defaultEventSource(event.source)));
    const id = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
    db.prepare("UPDATE knowledge_governance_message SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, localMessageId);
    return id;
  });
  return fromEventRow(db.prepare("SELECT * FROM knowledge_governance_message_event WHERE id = ?").get(transaction() as number) as PersistedMessageEventRow);
}

export function getMessage(db: Database.Database, messageId: number, conversationId?: string): Message | null {
  return mapGovernanceMessage(db, assertLocalId(messageId, "message"), conversationId);
}

export function getMessages(db: Database.Database, conversationId: string, limit = 100, offset = 0): MessageWithEvents[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?").all(conversationId, limit, offset) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getLatestMessage(db: Database.Database, conversationId: string): MessageWithEvents | null {
  const row = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(conversationId) as Record<string, unknown> | undefined;
  return row ? attachGovernanceMessageEvents(db, [row])[0] ?? null : null;
}

export function getLatestRespondingRole(db: Database.Database, conversationId: string, participatingRoles: RoleName[]): RoleName | null {
  const candidates = participatingRoles.filter((roleName) => roleName !== "Boss Role");
  if (candidates.length === 0) return null;
  const row = db.prepare(
    `SELECT from_role FROM knowledge_governance_message
     WHERE conversation_id = ?
       AND role = 'assistant'
       AND from_role IS NOT NULL
       AND from_role IN (${candidates.map(() => "?").join(", ")})
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 1`
  ).get(conversationId, ...candidates) as { from_role: RoleName } | undefined;
  return row?.from_role ?? null;
}

export function listStreamingAssistantMessages(db: Database.Database): Message[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE role = 'assistant' AND status = 'streaming' ORDER BY datetime(created_at) ASC, id ASC").all() as Record<string, unknown>[];
  return rows.map((row) => mapGovernanceMessage(db, Number(row.id), String(row.conversation_id))).filter((message): message is Message => Boolean(message));
}

export function getRecentConversationMessagesWindow(db: Database.Database, conversationId: string, userMessageCount = 3): MessageWithEvents[] {
  const anchorRow = db.prepare("SELECT id FROM knowledge_governance_message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 1 OFFSET ?").get(conversationId, Math.max(0, userMessageCount - 1)) as { id: number } | undefined;
  if (!anchorRow) return getMessages(db, conversationId);
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id >= ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorRow.id) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getMessageEvents(db: Database.Database, messageId: number): MessageEvent[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message_event WHERE message_id = ? ORDER BY seq ASC").all(assertLocalId(messageId, "message")) as PersistedMessageEventRow[];
  return rows.map(fromEventRow);
}

export function getRecentMessagesSnapshot(db: Database.Database, conversationId: string, limit: number, beforeCursorHook?: (snapshotEventId: number) => void): RecentMessagesSnapshot {
  const transaction = db.transaction(() => {
    const snapshotEventId = getLastMessageEventId(db, conversationId);
    beforeCursorHook?.(snapshotEventId);
    const rows = db.prepare(`SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND (id IN (SELECT id FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?) OR status = 'streaming') ORDER BY datetime(created_at) ASC, id ASC`).all(conversationId, conversationId, limit) as Record<string, unknown>[];
    const items = attachGovernanceMessageEventsAtOrBefore(db, rows, snapshotEventId);
    return { items, last_event_id: snapshotEventId };
  });
  return transaction() as RecentMessagesSnapshot;
}

export function getLastMessageEventId(db: Database.Database, conversationId: string): number {
  const row = db.prepare(`SELECT COALESCE(MAX(knowledge_governance_message_event.id), 0) AS id FROM knowledge_governance_message_event JOIN knowledge_governance_message ON knowledge_governance_message.id = knowledge_governance_message_event.message_id WHERE knowledge_governance_message.conversation_id = ?`).get(conversationId) as { id: number } | undefined;
  return row?.id ?? 0;
}

export function getMessageEventsAfter(db: Database.Database, conversationId: string, afterEventId: number, untilEventId: number | null = null): ConversationEventWithMessage[] {
  /**
   * Event cursors are scoped by conversation. Project and knowledge-governance tables
   * can both contain event id 1, so callers must keep passing conversationId instead
   * of treating a bare number as a global timeline cursor.
   */
  const afterLocalEventId = Number.isSafeInteger(afterEventId) && afterEventId > 0 ? afterEventId : 0;
  const untilLocalEventId = typeof untilEventId === "number" && Number.isSafeInteger(untilEventId) && untilEventId > 0 ? untilEventId : 0;
  const rows = untilLocalEventId > 0
    ? db.prepare(`SELECT knowledge_governance_message_event.*, knowledge_governance_message.from_role AS message_from_role FROM knowledge_governance_message_event JOIN knowledge_governance_message ON knowledge_governance_message.id = knowledge_governance_message_event.message_id WHERE knowledge_governance_message.conversation_id = ? AND knowledge_governance_message_event.id > ? AND knowledge_governance_message_event.id <= ? ORDER BY knowledge_governance_message_event.id ASC`).all(conversationId, afterLocalEventId, untilLocalEventId) as Array<PersistedMessageEventRow & { message_from_role: RoleName | null }>
    : db.prepare(`SELECT knowledge_governance_message_event.*, knowledge_governance_message.from_role AS message_from_role FROM knowledge_governance_message_event JOIN knowledge_governance_message ON knowledge_governance_message.id = knowledge_governance_message_event.message_id WHERE knowledge_governance_message.conversation_id = ? AND knowledge_governance_message_event.id > ? ORDER BY knowledge_governance_message_event.id ASC`).all(conversationId, afterLocalEventId) as Array<PersistedMessageEventRow & { message_from_role: RoleName | null }>;
  return rows.map((row) => ({ ...fromEventRow(row), message_from_role: row.message_from_role }));
}

export function getMessagesByIds(db: Database.Database, conversationId: string, externalMessageIds: number[]): MessageWithEvents[] {
  const messageIds = externalMessageIds.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!messageIds.length) return [];
  const rows = db.prepare(`SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id IN (${messageIds.map(() => "?").join(", ")}) ORDER BY datetime(created_at) ASC, id ASC`).all(conversationId, ...messageIds) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getMessageWindow(input: { db: Database.Database; conversationId: string; anchorMessageId: number; before?: number; after?: number }): MessageWithEvents[] {
  const { db, conversationId, anchorMessageId, before = 2, after = 2 } = input;
  if (!Number.isSafeInteger(anchorMessageId) || anchorMessageId <= 0) return [];
  const anchor = db.prepare("SELECT id FROM knowledge_governance_message WHERE conversation_id = ? AND id = ?").get(conversationId, anchorMessageId) as { id: number } | undefined;
  if (!anchor) return [];
  const rows = db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id BETWEEN ? AND ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorMessageId - before, anchorMessageId + after) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function searchConversationMessages(_input: { db: Database.Database; conversationId: string; query: string; limit?: number; offset?: number }): ConversationHistorySearchResult[] {
  return [];
}

export function upsertMessageContext(db: Database.Database, messageId: number, kind: MessageContextKind, context: string): MessageContext {
  const localMessageId = assertLocalId(messageId, "message");
  db.prepare("INSERT INTO knowledge_governance_message_context (message_id, kind, context, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(message_id) DO UPDATE SET kind = excluded.kind, context = excluded.context, updated_at = datetime('now')").run(localMessageId, kind, context);
  return getMessageContext(db, localMessageId)!;
}

export function getMessageContext(db: Database.Database, messageId: number): MessageContext | null {
  const localMessageId = assertLocalId(messageId, "message");
  const row = db.prepare("SELECT * FROM knowledge_governance_message_context WHERE message_id = ?").get(localMessageId) as Record<string, unknown> | undefined;
  return row ? mapMessageContext(row) : null;
}

export function listPendingDispatches(db: Database.Database, conversationId: string, toRole?: RoleName): MessageDispatch[] {
  const sql = toRole ? "SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? AND to_role = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC" : "SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC";
  const params = toRole ? [conversationId, toRole] : [conversationId];
  return (db.prepare(sql).all(...params) as MessageDispatch[]).map(fromDispatchRow);
}

export function listDispatches(db: Database.Database, conversationId: string): MessageDispatch[] {
  return (db.prepare("SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[]).map(fromDispatchRow);
}

export function listDispatchInboxGroups(db: Database.Database, conversationId: string): DispatchInboxGroup[] {
  const rows = db.prepare(`SELECT to_role, status, GROUP_CONCAT(id) as dispatch_ids, GROUP_CONCAT(message_id) as message_ids, MAX(created_at) as latest_dispatch_at FROM knowledge_governance_message_dispatch WHERE conversation_id = ? GROUP BY to_role, status ORDER BY datetime(latest_dispatch_at) ASC, to_role ASC`).all(conversationId) as Array<{ to_role: RoleName; status: "pending" | "seen" | "consumed" | "skipped"; dispatch_ids: string; message_ids: string; latest_dispatch_at: string }>;
  return rows.map((row) => ({ to_role: row.to_role, status: row.status, dispatch_ids: row.dispatch_ids.split(",").map(Number).filter(Number.isInteger), message_ids: row.message_ids.split(",").map(Number).filter(Number.isInteger), latest_dispatch_at: row.latest_dispatch_at }));
}

export function markDispatchesConsumed(db: Database.Database, dispatchIds: number[], consumedByMessageId: number | null = null): void {
  if (!dispatchIds.length) return;
  const localDispatchIds = dispatchIds.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!localDispatchIds.length) return;
  const placeholders = localDispatchIds.map(() => "?").join(", ");
  const consumedBy = consumedByMessageId ? assertLocalId(consumedByMessageId, "consumed by message") : null;
  db.prepare(`UPDATE knowledge_governance_message_dispatch SET status = 'consumed', consumed_by_message_id = ?, consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(consumedBy, ...localDispatchIds);
}

export function markDispatchesSeen(db: Database.Database, dispatchIds: number[]): void {
  updateDispatchStatus(db, dispatchIds, "seen");
}

export function skipDispatches(db: Database.Database, dispatchIds: number[]): void {
  updateDispatchStatus(db, dispatchIds, "skipped");
}

export function listBossPendingDispatches(db: Database.Database, conversationId: string): MessageDispatch[] {
  return (db.prepare("SELECT * FROM knowledge_governance_message_dispatch WHERE conversation_id = ? AND to_role = 'Boss Role' AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[]).map(fromDispatchRow);
}

export function updateMessageRouting(db: Database.Database, messageId: number, toRoles: RoleName[], conversationId?: string): void {
  const message = getMessage(db, messageId, conversationId);
  if (!message) return;
  db.prepare("UPDATE knowledge_governance_message SET to_roles = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(toRoles), messageId);
  db.prepare("DELETE FROM knowledge_governance_message_dispatch WHERE message_id = ?").run(messageId);
  for (const toRole of toRoles) db.prepare("INSERT INTO knowledge_governance_message_dispatch (conversation_id, message_id, to_role) VALUES (?, ?, ?)").run(message.conversation_id, messageId, toRole);
}

export function getDispatchInboxMessages(db: Database.Database, conversationId: string, roleName: string, dispatchSourceMessageIds: number[]): MessageWithEvents[] {
  const sourceIds = dispatchSourceMessageIds.filter((id) => Number.isSafeInteger(id) && id > 0);
  const sourcePlaceholders = sourceIds.map(() => "?").join(", ");
  const lastReply = db.prepare("SELECT id, context_cutoff_at FROM knowledge_governance_message WHERE conversation_id = ? AND role = 'assistant' AND from_role = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(conversationId, roleName) as { id: number; context_cutoff_at: string | null } | undefined;
  const cutoff = buildInboxCutoff(lastReply);
  const sourcePredicate = sourceIds.length > 0 ? ` OR id IN (${sourcePlaceholders})` : "";
  const rows = db.prepare(`SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND (${cutoff.predicate}${sourcePredicate}) ORDER BY datetime(created_at) ASC, id ASC`).all(conversationId, ...cutoff.params, ...sourceIds) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

export function getMessagesSinceRoleReply(db: Database.Database, conversationId: string, roleName: string): MessageWithEvents[] {
  const lastSnailReply = db.prepare("SELECT id FROM knowledge_governance_message WHERE conversation_id = ? AND role = 'assistant' AND from_role = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1").get(conversationId, roleName) as { id: number } | undefined;
  const rows = lastSnailReply
    ? db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? AND id > ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, lastSnailReply.id) as Record<string, unknown>[]
    : db.prepare("SELECT * FROM knowledge_governance_message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as Record<string, unknown>[];
  return attachGovernanceMessageEvents(db, rows);
}

function updateDispatchStatus(db: Database.Database, dispatchIds: number[], status: "seen" | "skipped"): void {
  if (!dispatchIds.length) return;
  const localDispatchIds = dispatchIds.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!localDispatchIds.length) return;
  db.prepare(`UPDATE knowledge_governance_message_dispatch SET status = ?, consumed_at = datetime('now') WHERE id IN (${localDispatchIds.map(() => "?").join(", ")})`).run(status, ...localDispatchIds);
}

function buildInboxCutoff(lastReply: { id: number; context_cutoff_at: string | null } | undefined): { predicate: string; params: number[] } {
  if (!lastReply) return { predicate: "1 = 1", params: [] };
  const cutoffValue = lastReply.context_cutoff_at ?? "";
  if (!/^\d+$/.test(cutoffValue)) throw new Error(`Invalid context_cutoff_at cutoff message id for message ${lastReply.id}: ${cutoffValue}`);
  const cutoffMessageId = Number(cutoffValue);
  return { predicate: "(id > ? AND id != ?)", params: [cutoffMessageId, lastReply.id] };
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

function getMessageEventsAtOrBefore(db: Database.Database, messageId: number, snapshotEventId: number): MessageEvent[] {
  const rows = db.prepare("SELECT * FROM knowledge_governance_message_event WHERE message_id = ? AND id <= ? ORDER BY seq ASC").all(assertLocalId(messageId, "message"), snapshotEventId) as PersistedMessageEventRow[];
  return rows.map(fromEventRow);
}

function fromMessageRow(row: Record<string, unknown>): Message {
  return mapMessage(row);
}

function fromDispatchRow(row: MessageDispatch): MessageDispatch {
  return row;
}

function fromEventRow(row: PersistedMessageEventRow): MessageEvent {
  return mapMessageEvent(row);
}
