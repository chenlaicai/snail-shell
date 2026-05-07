import Database from "better-sqlite3";
import path from "path";
import { loadStageDefinitions } from "../meta";
import {
  attachMessageEvents,
  buildSearchableMessageContent,
  defaultEventSource,
  eventCategoryForKind,
  mapConversation,
  mapMessage,
  mapMessageEvent,
  mapStage,
  serializeMessageEventPayload,
  serializeMessageEventSource,
} from "./helpers";
import { KnowledgeModel } from "./knowledge-model";
import * as messageReadModel from "./message-read-model";
import * as messageContextModel from "./message-context-model";
import { SCHEMA_SQL } from "./schema";
export type {
  Artifact,
  ArtifactContentOptions,
  ArtifactStatus,
  ArtifactStorageType,
  ArtifactType,
  CommandEventPayload,
  CommandResultEventPayload,
  ContentBlockEventPayload,
  Conversation,
  ConversationHistorySearchResult,
  ConversationKind,
  ConversationStatus,
  CreateArtifactInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  CreateMessageEventInput,
  CreateMessageInput,
  CreateStageInput,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  ErrorEventPayload,
  Feature,
  FeatureStatus,
  Message,
  MessageContext,
  MessageContextKind,
  MessageContentBlock,
  MessageDispatch,
  MessageEvent,
  MessageEventPayload,
  MessageEventSource,
  MessageRole,
  MessageRuntime,
  MessageStatus,
  MessageWithEvents,
  PersistedMessageEventRow,
  Project,
  ProjectKind,
  ProjectStatus,
  SignalEventPayload,
  SnailName,
  Stage,
  StageStatus,
  StageType,
  StartEventPayload,
  TextEventPayload,
  ToolCallEventPayload,
  ToolResultEventPayload,
} from "./types";
import type {
  Artifact,
  ArtifactType,
  Conversation,
  ConversationHistorySearchResult,
  CreateArtifactInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  CreateMessageEventInput,
  CreateMessageInput,
  CreateStageInput,
  DispatchInboxGroup,
  Feature,
  FeatureStatus,
  Message,
  MessageContext,
  MessageContextKind,
  MessageDispatch,
  MessageEvent,
  MessageStatus,
  MessageWithEvents,
  PersistedMessageEventRow,
  Project,
  ProjectKind,
  SnailName,
  Stage,
  StageType,
} from "./types";
export type { CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeItem, KnowledgeKind, KnowledgeListFilters, KnowledgeScopeType, KnowledgeSearchResult, KnowledgeSource, KnowledgeStatus, KnowledgeUsagePolicy, KnowledgeUsagePolicyInput, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";
import type { CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeListFilters, KnowledgeSearchResult, KnowledgeUsagePolicy, KnowledgeUsagePolicyInput, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";

export const STAGE_DEFINITIONS = loadStageDefinitions();
export const STAGE_TYPES = Object.keys(STAGE_DEFINITIONS) as StageType[];
export const STAGE_FORMAL_ARTIFACT_TYPES: Record<StageType, ArtifactType[]> = Object.fromEntries(
  Object.entries(STAGE_DEFINITIONS).map(([type, config]) => [type, config.formal_artifact_types])
) as Record<StageType, ArtifactType[]>;

export class ConversationStore {
  private db: Database.Database;
  private knowledge: KnowledgeModel;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "snail-shell.db");
    const dir = path.dirname(resolvedPath);
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.knowledge = new KnowledgeModel(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(SCHEMA_SQL);
    this.ensureMessageClientIdColumn();
  }

  private ensureMessageClientIdColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(message)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "client_id")) {
      this.db.exec("ALTER TABLE message ADD COLUMN client_id TEXT");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_message_conversation_client_id ON message(conversation_id, client_id)");
  }

  createProject(id: string, kind: ProjectKind, name: string, summary?: string): Project {
    this.db.prepare("INSERT INTO project (id, kind, name, summary, status) VALUES (?, ?, ?, ?, 'active')").run(id, kind, name, summary ?? null);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | undefined {
    return this.db.prepare("SELECT * FROM project WHERE id = ?").get(id) as Project | undefined;
  }

  findProjectByNameAndKind(name: string, kind: ProjectKind): Project | undefined {
    return this.db.prepare("SELECT * FROM project WHERE name = ? AND kind = ? ORDER BY created_at ASC LIMIT 1").get(name, kind) as Project | undefined;
  }

  listProjects(limit = 50, offset = 0): Project[] {
    return this.db.prepare("SELECT * FROM project ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Project[];
  }

  createKnowledge(input: CreateKnowledgeInput): KnowledgeWithDetails {
    return this.knowledge.create(input);
  }

  getKnowledge(id: string): KnowledgeWithDetails | null {
    return this.knowledge.get(id);
  }

  listKnowledge(filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] {
    return this.knowledge.list(filters);
  }

  searchKnowledge(filters: KnowledgeListFilters): KnowledgeSearchResult[] {
    return this.knowledge.search(filters);
  }

  getKnowledgeUsagePolicy(knowledgeId: string): KnowledgeUsagePolicy | null {
    return this.knowledge.policy(knowledgeId);
  }

  upsertKnowledgeUsagePolicy(knowledgeId: string, input: KnowledgeUsagePolicyInput): KnowledgeUsagePolicy {
    return this.knowledge.upsertPolicy(knowledgeId, input);
  }

  approveKnowledge(id: string, input: KnowledgeApprovalInput): KnowledgeWithDetails {
    return this.knowledge.approve(id, input);
  }

  rejectKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return this.knowledge.reject(id, reviewer, comment);
  }

  archiveKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return this.knowledge.archive(id, reviewer, comment);
  }

  deprecateKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails {
    return this.knowledge.deprecate(id, reviewer, comment);
  }

  recordKnowledgeUse(input: RecordKnowledgeUseInput): KnowledgeUse {
    return this.knowledge.recordUse(input);
  }

  listKnowledgeUses(knowledgeId: string, limit = 50, offset = 0): KnowledgeUse[] {
    return this.knowledge.uses(knowledgeId, limit, offset);
  }

  listPromptInjectableKnowledge(input: { projectId: string; featureId: string; stageType: StageType; snailName: SnailName; conversationId?: string | null; stageId?: string | null; limit?: number }): KnowledgeWithDetails[] {
    return this.knowledge.injectable(input);
  }

  createFeature(input: { id: string; projectId: string; title: string; summary?: string | null; status?: FeatureStatus; branchName?: string | null; worktreePath?: string | null; prUrl?: string | null }): Feature {
    this.db.prepare(
      "INSERT INTO feature (id, project_id, title, summary, status, branch_name, worktree_path, pr_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.title, input.summary ?? null, input.status ?? "active", input.branchName ?? null, input.worktreePath ?? null, input.prUrl ?? null);
    return this.getFeature(input.id)!;
  }

  getFeature(id: string): Feature | undefined { return this.db.prepare("SELECT * FROM feature WHERE id = ?").get(id) as Feature | undefined; }

  listFeatures(projectId: string): Feature[] {
    return this.db.prepare("SELECT * FROM feature WHERE project_id = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC").all(projectId) as Feature[];
  }

  updateFeature(id: string, updates: Partial<Pick<Feature, "title" | "summary" | "status" | "branch_name" | "worktree_path" | "pr_url" | "closed_at">>): Feature {
    const feature = this.getFeature(id);
    if (!feature) throw new Error(`Feature not found: ${id}`);
    this.db.prepare(
      "UPDATE feature SET title = ?, summary = ?, status = ?, branch_name = ?, worktree_path = ?, pr_url = ?, closed_at = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? feature.title,
      updates.summary ?? feature.summary,
      updates.status ?? feature.status,
      updates.branch_name ?? feature.branch_name,
      updates.worktree_path ?? feature.worktree_path,
      updates.pr_url ?? feature.pr_url,
      updates.closed_at ?? feature.closed_at,
      id
    );
    return this.getFeature(id)!;
  }

  createStage(input: CreateStageInput): Stage {
    this.db.prepare(
      "INSERT INTO stage (id, project_id, feature_id, type, sequence, status, formal_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.featureId, input.type, input.sequence, input.status, JSON.stringify(input.formalArtifacts ?? []), input.enteredAt ?? null);
    return this.getStage(input.id)!;
  }

  getStage(id: string): Stage | undefined {
    const row = this.db.prepare("SELECT * FROM stage WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapStage(row) : undefined;
  }

  listStages(projectId: string): Stage[] {
    const rows = this.db.prepare("SELECT * FROM stage WHERE project_id = ? ORDER BY datetime(created_at) ASC, sequence ASC").all(projectId) as Record<string, unknown>[];
    return rows.map(mapStage);
  }

  listStagesByFeature(featureId: string): Stage[] {
    const rows = this.db.prepare("SELECT * FROM stage WHERE feature_id = ? ORDER BY sequence ASC").all(featureId) as Record<string, unknown>[];
    return rows.map(mapStage);
  }

  getActiveStage(featureId: string): Stage | undefined {
    const row = this.db
      .prepare("SELECT * FROM stage WHERE feature_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1")
      .get(featureId) as Record<string, unknown> | undefined;
    return row ? mapStage(row) : undefined;
  }

  updateStage(id: string, updates: Partial<Pick<Stage, "status" | "formal_artifacts" | "entered_at" | "left_at">>): Stage {
    const stage = this.getStage(id);
    if (!stage) throw new Error(`Stage not found: ${id}`);
    this.db.prepare(
      "UPDATE stage SET status = ?, formal_artifacts = ?, entered_at = ?, left_at = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.status ?? stage.status,
      JSON.stringify(updates.formal_artifacts ?? stage.formal_artifacts),
      updates.entered_at ?? stage.entered_at,
      updates.left_at ?? stage.left_at,
      id
    );
    return this.getStage(id)!;
  }

  createConversation(input: CreateConversationInput): Conversation {
    this.db.prepare(
      "INSERT INTO conversation (id, project_id, feature_id, stage_id, title, kind, status, default_snail, participating_snails, summary, from_conversation_ids, runtime_sessions) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)"
    ).run(
      input.id,
      input.projectId,
      input.featureId,
      input.stageId,
      input.title,
      input.kind,
      input.defaultSnail,
      JSON.stringify(input.participatingSnails),
      input.summary ?? null,
      JSON.stringify(input.fromConversationIds ?? []),
      JSON.stringify({})
    );
    return this.getConversation(input.id)!;
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversation WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapConversation(row) : undefined;
  }

  listConversationsByProject(projectId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as Record<string, unknown>[];
    return rows.map(mapConversation);
  }

  listConversationsByFeature(featureId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE feature_id = ? ORDER BY updated_at DESC").all(featureId) as Record<string, unknown>[];
    return rows.map(mapConversation);
  }

  listConversationsByStage(stageId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId) as Record<string, unknown>[];
    return rows.map(mapConversation);
  }

  getInitialConversationByStage(stageId: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversation WHERE stage_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1").get(stageId) as Record<string, unknown> | undefined;
    return row ? mapConversation(row) : undefined;
  }

  updateConversation(id: string, updates: Partial<Pick<Conversation, "status" | "summary" | "from_conversation_ids" | "participating_snails" | "title" | "runtime_sessions">>): Conversation {
    const conversation = this.getConversation(id);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    this.db.prepare(
      "UPDATE conversation SET title = ?, status = ?, participating_snails = ?, summary = ?, from_conversation_ids = ?, runtime_sessions = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? conversation.title,
      updates.status ?? conversation.status,
      JSON.stringify(updates.participating_snails ?? conversation.participating_snails),
      updates.summary ?? conversation.summary,
      JSON.stringify(updates.from_conversation_ids ?? conversation.from_conversation_ids),
      JSON.stringify(updates.runtime_sessions ?? conversation.runtime_sessions),
      id
    );
    return this.getConversation(id)!;
  }

  addMessage(input: CreateMessageInput): Message {
    const insert = this.db.prepare(
      "INSERT INTO message (conversation_id, client_id, from_snail, to_snails, role, quoted_message_id, context_cutoff_at, runtime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const updateConversation = this.db.prepare("UPDATE conversation SET updated_at = datetime('now') WHERE id = ?");
    const updateProject = this.db.prepare("UPDATE project SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM conversation WHERE id = ?)");
    const updateFeature = this.db.prepare("UPDATE feature SET updated_at = datetime('now') WHERE id = (SELECT feature_id FROM conversation WHERE id = ?)");

    const transaction = this.db.transaction((payload: CreateMessageInput) => {
      insert.run(
        payload.conversationId,
        payload.clientId ?? null,
        payload.fromSnail,
        JSON.stringify(payload.toSnails ?? []),
        payload.role,
        payload.quotedMessageId ?? null,
        payload.contextCutoffAt ?? "0",
        payload.runtime ?? null,
        payload.status ?? (payload.role === "assistant" ? "streaming" : "completed")
      );
      const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
      for (const toSnail of payload.toSnails ?? []) {
        this.db.prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_snail) VALUES (?, ?, ?)").run(payload.conversationId, id, toSnail);
      }
      updateConversation.run(payload.conversationId);
      updateProject.run(payload.conversationId);
      updateFeature.run(payload.conversationId);
      return id;
    });

    const id = transaction(input) as number;
    return this.getMessage(id)!;
  }

  addMessageEvent(messageId: number, event: CreateMessageEventInput): MessageEvent {
    const message = this.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.status !== "streaming") {
      throw new Error(`Cannot append event to terminal message ${messageId}`);
    }

    const source = defaultEventSource(event.source);
    const category = eventCategoryForKind(event.kind);
    const insert = this.db.prepare("INSERT INTO message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)");
    const nextSeqStmt = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_event WHERE message_id = ?");
    const transaction = this.db.transaction(() => {
      const { seq } = nextSeqStmt.get(messageId) as { seq: number };
      if (seq === 1 && event.kind !== "start") {
        throw new Error(`first event must be start for message ${messageId}`);
      }
      if (seq !== 1 && event.kind === "start") {
        throw new Error(`start event must be the first event for message ${messageId}`);
      }
      insert.run(messageId, seq, category, event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(source));
      return (this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
    });
    const id = transaction() as number;
    return mapMessageEvent(this.db.prepare("SELECT * FROM message_event WHERE id = ?").get(id) as PersistedMessageEventRow);
  }

  addMessageEvents(messageId: number, events: CreateMessageEventInput[]): MessageEvent[] {
    return events.map((event) => this.addMessageEvent(messageId, event));
  }

  completeMessageWithEvent(messageId: number, event: CreateMessageEventInput, status: Exclude<MessageStatus, "streaming">): MessageEvent {
    const insert = this.db.prepare("INSERT INTO message_event (message_id, seq, category, kind, payload, source) VALUES (?, ?, ?, ?, ?, ?)");
    const nextSeqStmt = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM message_event WHERE message_id = ?");
    const update = this.db.prepare("UPDATE message SET status = ?, updated_at = datetime('now') WHERE id = ?");
    const transaction = this.db.transaction(() => {
      const message = this.getMessage(messageId);
      if (!message) throw new Error(`Message not found: ${messageId}`);
      if (message.status !== "streaming") throw new Error(`Cannot complete terminal message ${messageId}`);
      const { seq } = nextSeqStmt.get(messageId) as { seq: number };
      if (seq === 1) throw new Error(`Cannot complete message ${messageId} before start event`);
      insert.run(messageId, seq, eventCategoryForKind(event.kind), event.kind, serializeMessageEventPayload(event.payload), serializeMessageEventSource(defaultEventSource(event.source)));
      const id = (this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
      update.run(status, messageId);
      return id;
    });
    const id = transaction() as number;
    return mapMessageEvent(this.db.prepare("SELECT * FROM message_event WHERE id = ?").get(id) as PersistedMessageEventRow);
  }

  upsertMessageContext(messageId: number, kind: MessageContextKind, context: string): MessageContext {
    const message = this.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    const persisted = messageContextModel.upsertMessageContext({ db: this.db, messageId, kind, context });
    this.reindexMessage(messageId);
    return persisted;
  }

  getMessageContext(messageId: number): MessageContext | null {
    return messageContextModel.getMessageContext(this.db, messageId);
  }

  updateMessageStatus(messageId: number, status: MessageStatus): void {
    this.db.prepare("UPDATE message SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, messageId);
  }

  getMessageEvents(messageId: number): MessageEvent[] {
    const rows = this.db.prepare("SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC").all(messageId) as PersistedMessageEventRow[];
    return rows.map(mapMessageEvent);
  }

  getMessage(messageId: number, conversationId?: string): Message | null {
    const query = conversationId ? "SELECT * FROM message WHERE id = ? AND conversation_id = ?" : "SELECT * FROM message WHERE id = ?";
    const params = conversationId ? [messageId, conversationId] : [messageId];
    const row = this.db.prepare(query).get(...params) as Record<string, unknown> | undefined;
    return row ? mapMessage(row) : null;
  }

  listStreamingAssistantMessages(): Message[] {
    const rows = this.db.prepare("SELECT * FROM message WHERE role = 'assistant' AND status = 'streaming' ORDER BY datetime(created_at) ASC, id ASC").all() as Record<string, unknown>[];
    return rows.map(mapMessage);
  }

  getMessages(conversationId: string, limit = 100, offset = 0): MessageWithEvents[] {
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?").all(conversationId, limit, offset) as Record<string, unknown>[];
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId), (messageId) => this.getMessageContext(messageId));
  }

  getRecentMessages(conversationId: string, limit = 5): MessageWithEvents[] {
    return messageReadModel.getRecentMessages({ db: this.db, conversationId, limit, getMessageEvents: (messageId) => this.getMessageEvents(messageId) });
  }

  getRecentMessagesSnapshot(conversationId: string, limit = 5, beforeCursorHook?: (snapshotEventId: number) => void): messageReadModel.RecentMessagesSnapshot {
    return messageReadModel.getRecentMessagesSnapshot({ db: this.db, conversationId, limit, beforeCursorHook });
  }

  getLastMessageEventId(conversationId: string): number {
    return messageReadModel.getLastMessageEventId(this.db, conversationId);
  }

  getMessageEventsAfter(conversationId: string, afterEventId: number, untilEventId: number | null = null): messageReadModel.ConversationEventWithMessage[] {
    return messageReadModel.getMessageEventsAfter(this.db, conversationId, afterEventId, untilEventId);
  }

  getRecentConversationMessagesWindow(conversationId: string, userMessageCount = 3): MessageWithEvents[] {
    const normalizedMessageCount = Math.max(1, userMessageCount);
    const anchorRow = this.db.prepare(
      `SELECT id FROM message
       WHERE conversation_id = ? AND role = 'user'
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 1 OFFSET ?`
    ).get(conversationId, normalizedMessageCount - 1) as { id: number } | undefined;

    if (!anchorRow) return this.getMessages(conversationId);
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id >= ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorRow.id) as Record<string, unknown>[];
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId), (messageId) => this.getMessageContext(messageId));
  }

  getMessagesSinceSnailReply(conversationId: string, snailName: string): MessageWithEvents[] {
    return messageReadModel.getMessagesSinceSnailReply({ db: this.db, conversationId, snailName, getMessageEvents: (messageId) => this.getMessageEvents(messageId) });
  }

  getDispatchInboxMessages(conversationId: string, snailName: string, dispatchSourceMessageIds: number[]): MessageWithEvents[] {
    return messageReadModel.getDispatchInboxMessages({ db: this.db, conversationId, snailName, dispatchSourceMessageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId) });
  }

  getMessagesByIds(conversationId: string, messageIds: number[]): MessageWithEvents[] {
    return messageReadModel.getMessagesByIds({ db: this.db, conversationId, messageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId) });
  }

  getMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): MessageWithEvents[] {
    return messageReadModel.getMessageWindow({ db: this.db, conversationId, anchorMessageId, before, after, getMessageEvents: (messageId) => this.getMessageEvents(messageId) });
  }

  searchConversationMessages(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchResult[] {
    return messageReadModel.searchConversationMessages({ db: this.db, conversationId, query, limit, offset });
  }

  addMessageDispatch(input: CreateMessageDispatchInput): MessageDispatch {
    this.db.prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_snail) VALUES (?, ?, ?)").run(input.conversationId, input.messageId, input.toSnail);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.db.prepare("SELECT * FROM message_dispatch WHERE id = ?").get(id) as MessageDispatch;
  }

  rebuildDispatchesForMessage(messageId: number): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("DELETE FROM message_dispatch WHERE message_id = ?").run(messageId);
    for (const toSnail of message.to_snails) {
      this.addMessageDispatch({ conversationId: message.conversation_id, messageId: message.id, toSnail });
    }
  }

  updateMessageRouting(messageId: number, toSnails: SnailName[]): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("UPDATE message SET to_snails = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(toSnails), messageId);
    this.rebuildDispatchesForMessage(messageId);
  }

  listPendingDispatches(conversationId: string, toSnail?: SnailName): MessageDispatch[] {
    if (toSnail) {
      return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_snail = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, toSnail) as MessageDispatch[];
    }
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
  }

  listDispatches(conversationId: string): MessageDispatch[] {
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
  }

  listDispatchInboxGroups(conversationId: string): DispatchInboxGroup[] {
    const rows = this.db.prepare(
      `SELECT to_snail, status, GROUP_CONCAT(id) as dispatch_ids, GROUP_CONCAT(message_id) as message_ids, MAX(created_at) as latest_dispatch_at
       FROM message_dispatch
       WHERE conversation_id = ?
       GROUP BY to_snail, status
       ORDER BY datetime(latest_dispatch_at) ASC, to_snail ASC`
    ).all(conversationId) as Array<{ to_snail: SnailName; status: "pending" | "seen" | "consumed" | "skipped"; dispatch_ids: string; message_ids: string; latest_dispatch_at: string }>;
    return rows.map((row) => ({
      to_snail: row.to_snail,
      status: row.status,
      dispatch_ids: row.dispatch_ids.split(",").map(Number).filter(Number.isInteger),
      message_ids: row.message_ids.split(",").map(Number).filter(Number.isInteger),
      latest_dispatch_at: row.latest_dispatch_at,
    }));
  }

  markDispatchesConsumed(dispatchIds: number[], consumedByMessageId: number | null = null): void {
    if (dispatchIds.length === 0) return;
    const placeholders = dispatchIds.map(() => "?").join(", ");
    this.db.prepare(`UPDATE message_dispatch SET status = 'consumed', consumed_by_message_id = ?, consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(consumedByMessageId, ...dispatchIds);
  }

  markDispatchesSeen(dispatchIds: number[]): void {
    if (dispatchIds.length === 0) return;
    const placeholders = dispatchIds.map(() => "?").join(", ");
    this.db.prepare(`UPDATE message_dispatch SET status = 'seen', consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(...dispatchIds);
  }

  skipDispatches(dispatchIds: number[]): void {
    if (dispatchIds.length === 0) return;
    const placeholders = dispatchIds.map(() => "?").join(", ");
    this.db.prepare(`UPDATE message_dispatch SET status = 'skipped', consumed_at = datetime('now') WHERE id IN (${placeholders})`).run(...dispatchIds);
  }

  listBossPendingDispatches(conversationId: string): MessageDispatch[] {
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_snail = 'Boss Snail' AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
  }

  rebuildSearchIndex(conversationId?: string): { indexed_messages: number } {
    const targetMessages = conversationId
      ? this.db.prepare("SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as Array<{ id: number }>
      : this.db.prepare("SELECT id FROM message ORDER BY datetime(created_at) ASC, id ASC").all() as Array<{ id: number }>;
    if (conversationId) this.db.prepare("DELETE FROM message_search WHERE conversation_id = ?").run(conversationId);
    else this.db.prepare("DELETE FROM message_search").run();
    targetMessages.forEach((message) => this.reindexMessage(message.id));
    return { indexed_messages: targetMessages.length };
  }

  private reindexMessage(messageId: number): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("DELETE FROM message_search WHERE message_id = ?").run(String(messageId));
    const content = buildSearchableMessageContent(message.role, this.getMessageContext(messageId), this.getMessageEvents(messageId));
    if (!content) return;
    this.db.prepare("INSERT INTO message_search (conversation_id, message_id, role, from_snail, content) VALUES (?, ?, ?, ?, ?)").run(message.conversation_id, String(message.id), message.role, message.from_snail, content);
  }

  createArtifact(input: CreateArtifactInput): Artifact {
    this.db.prepare(
      "INSERT INTO artifact (id, project_id, feature_id, stage_id, conversation_id, artifact_type, title, status, storage_type, file_path, inline_content, external_ref, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.featureId, input.stageId, input.conversationId, input.artifactType, input.title, input.status, input.storageType, input.options?.filePath ?? null, input.options?.inlineContent ?? null, input.options?.externalRef ?? null, input.options?.metadata ?? null);
    return this.getArtifact(input.id)!;
  }

  getArtifact(id: string): Artifact | undefined { return this.db.prepare("SELECT * FROM artifact WHERE id = ?").get(id) as Artifact | undefined; }

  listArtifactsByStage(stageId: string): Artifact[] { return this.db.prepare("SELECT * FROM artifact WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId) as Artifact[]; }

  listArtifactsByFeature(featureId: string): Artifact[] { return this.db.prepare("SELECT * FROM artifact WHERE feature_id = ? ORDER BY updated_at DESC").all(featureId) as Artifact[]; }

  listArtifactsByConversation(conversationId: string): Artifact[] { return this.db.prepare("SELECT * FROM artifact WHERE conversation_id = ? ORDER BY updated_at DESC").all(conversationId) as Artifact[]; }

  updateArtifact(id: string, updates: Partial<Omit<Artifact, "id" | "project_id" | "stage_id" | "conversation_id" | "created_at">>): Artifact {
    const artifact = this.getArtifact(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    this.db.prepare(
      "UPDATE artifact SET artifact_type = ?, title = ?, status = ?, storage_type = ?, file_path = ?, inline_content = ?, external_ref = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(updates.artifact_type ?? artifact.artifact_type, updates.title ?? artifact.title, updates.status ?? artifact.status, updates.storage_type ?? artifact.storage_type, updates.file_path ?? artifact.file_path, updates.inline_content ?? artifact.inline_content, updates.external_ref ?? artifact.external_ref, updates.metadata ?? artifact.metadata, id);
    return this.getArtifact(id)!;
  }

  close(): void {
    this.db.close();
  }
}
