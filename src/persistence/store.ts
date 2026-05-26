import Database from "better-sqlite3";
import path from "path";
import {
  attachMessageEvents,
  buildSearchableMessageContent,
  defaultEventSource,
  eventCategoryForKind,
  mapConversation,
  mapFeature,
  mapMessage,
  mapMessageEvent,
  mapProject,
  mapStage,
  serializeMessageEventPayload,
  serializeMessageEventSource,
} from "./helpers";
import { KnowledgeModel } from "./knowledge-model";
import { KnowledgeLibraryModel } from "./knowledge-library-model";
import { listProjectBossPendingDispatches, markProjectDispatchesConsumed, markProjectDispatchesSeen, skipProjectDispatches } from "./dispatch-store";
import * as messageReadModel from "./message-read-model";
import * as messageContextModel from "./message-context-model";
import { SCHEMA_SQL } from "./schema";
import * as projectConfigModel from "./project-config-model";

export type {
  ContentBlockEventPayload,
  Conversation,
  ConversationHistorySearchResult,
  ConversationKind,
  ConversationStatus,
  CreateConversationInput,
  CreateMessageDispatchInput,
  CreateMessageEventInput,
  CreateMessageInput,
  CreateStageInput,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  Feature,
  Message,
  MessageContentBlock,
  MessageContext,
  MessageContextKind,
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
  ProjectStageDefinition,
  ProjectStatus,
  RoleName,
  Stage,
  StageRoleDefinition,
  StageStatus,
  StartEventPayload,
  TextEventPayload,
  ToolCallEventPayload,
  ToolResultEventPayload,
} from "./types";
import type {
  Conversation,
  ConversationHistorySearchResult,
  CreateConversationInput,
  CreateMessageDispatchInput,
  CreateMessageEventInput,
  CreateMessageInput,
  CreateStageInput,
  DispatchInboxGroup,
  Feature,
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
  ProjectStageDefinition,
  RoleName,
  Stage,
  StageRoleDefinition,
} from "./types";
export type { StageType } from "./types";
export type { CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeGovernance, KnowledgeGovernanceUpdateInput, KnowledgeItem, KnowledgeKind, KnowledgeListFilters, KnowledgeScopeType, KnowledgeSearchResult, KnowledgeSource, KnowledgeStatus, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";
import type { CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeGovernance, KnowledgeGovernanceUpdateInput, KnowledgeListFilters, KnowledgeSearchResult, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";
export type { CreateKnowledgeLibraryInput, KnowledgeLibraryEntry, KnowledgeLibraryKindSummary, KnowledgeLibraryListFilters, KnowledgeLibrarySearchResult, KnowledgeLibraryStatus, UpdateKnowledgeLibraryInput } from "../shared/knowledge-library-types";
import type { CreateKnowledgeLibraryInput, KnowledgeLibraryEntry, KnowledgeLibraryKindSummary, KnowledgeLibraryListFilters, KnowledgeLibrarySearchResult, UpdateKnowledgeLibraryInput } from "../shared/knowledge-library-types";

export interface SnailAgentSession {
  id: string;
  conversation_id: string;
  role_name: string;
  runtime: string;
  model: string;
  context_provider: "shell" | "agent";
  external_session_id: string | null;
  handoff_from_id: string | null;
  created_at: string;
}

export class ConversationStore {
  private db: Database.Database;
  private knowledge: KnowledgeModel;
  private knowledgeLibrary: KnowledgeLibraryModel;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "snail-shell.db");
    const dir = path.dirname(resolvedPath);
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.knowledge = new KnowledgeModel(this.db);
    this.knowledgeLibrary = new KnowledgeLibraryModel(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  // ── Database Bootstrap ────────────────────────────────────────────
  //
  // HARD RULE: initSchema() 在系统启动时调用，只允许 CREATE TABLE IF NOT EXISTS /
  // CREATE INDEX IF NOT EXISTS 这类纯新建操作。
  //
  // 严禁任何数据修改、迁移、删除动作（ALTER TABLE ADD COLUMN、UPDATE、DELETE、
  // DROP、table rebuild）。代码仓不保留任何自动迁移逻辑（如 migration 脚本、ALTER TABLE
  // 后补列等）。表结构变更必须由人感知并手工完成；不兼容变更只在 feature 文档中说明。
  //
  // 原因：initSchema() 连接的是生产数据库，任何自动执行的非新建操作都可能造成
  // 不可恢复的数据损失（参考 2026-05-20 事故：worktree 中的迁移在指向生产库时被
  // 自动触发，导致数据库被摧毁）。
  private initSchema(): void {
    this.db.exec(SCHEMA_SQL);
  }

  // ── Project Config Seed ──────────────────────────────────────────

  seedProjectConfigs(projects: projectConfigModel.ProjectConfigSeedItem[]): { created: boolean } {
    return projectConfigModel.seedProjectConfigs(this.db, projects);
  }

  seedStageDefinitionsForProject(projectId: string, stageDefinitions: projectConfigModel.StageDefinitionSeed): void {
    return projectConfigModel.seedStageDefinitionsForProject(this.db, projectId, stageDefinitions);
  }

  // ── Project Stage Definition ─────────────────────────────────────

  getStageDefinition(id: string): ProjectStageDefinition | undefined {
    return projectConfigModel.getStageDefinition(this.db, id);
  }

  getStageDefinitionByKey(projectId: string, key: string): ProjectStageDefinition | undefined {
    return projectConfigModel.getStageDefinitionByKey(this.db, projectId, key);
  }

  listStageDefinitions(projectId: string): ProjectStageDefinition[] {
    return projectConfigModel.listStageDefinitions(this.db, projectId);
  }

  // ── Stage Role Definition ────────────────────────────────────────

  getRoleDefinition(id: string): StageRoleDefinition | undefined { return projectConfigModel.getRoleDefinition(this.db, id); }
  listRoleDefinitions(stageDefinitionId: string): StageRoleDefinition[] { return projectConfigModel.listRoleDefinitions(this.db, stageDefinitionId); }
  listRoleDefinitionsByProject(projectId: string): StageRoleDefinition[] { return projectConfigModel.listRoleDefinitionsByProject(this.db, projectId); }
  listAllRoleDefinitions(): Array<StageRoleDefinition & { project_id: string }> { return projectConfigModel.listAllRoleDefinitions(this.db); }

  // ── Project ──────────────────────────────────────────────────────

  createProject(id: string, kind: ProjectKind, module: string, name: string, summary?: string, guardProfile?: Record<string, unknown> | null): Project {
    this.db.prepare("INSERT INTO project (id, kind, module, name, summary, status, guard_profile) VALUES (?, ?, ?, ?, ?, 'active', ?)").run(id, kind, module, name, summary ?? null, guardProfile ? JSON.stringify(guardProfile) : null);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM project WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapProject(row) : undefined;
  }

  findProjectByNameAndKind(name: string, kind: ProjectKind): Project | undefined {
    const row = this.db.prepare("SELECT * FROM project WHERE name = ? AND kind = ? ORDER BY created_at ASC LIMIT 1").get(name, kind) as Record<string, unknown> | undefined;
    return row ? mapProject(row) : undefined;
  }

  listProjects(limit = 50, offset = 0, module = "project-management"): Project[] {
    const rows = this.db.prepare("SELECT * FROM project WHERE module = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(module, limit, offset) as Record<string, unknown>[];
    return rows.map(mapProject);
  }

  // ── Knowledge ────────────────────────────────────────────────────

  createKnowledge(input: CreateKnowledgeInput): KnowledgeWithDetails { return this.knowledge.create(input); }
  getKnowledge(id: string): KnowledgeWithDetails | null { return this.knowledge.get(id); }
  listKnowledge(filters: KnowledgeListFilters = {}): KnowledgeSearchResult[] { return this.knowledge.list(filters); }
  searchKnowledge(filters: KnowledgeListFilters): KnowledgeSearchResult[] { return this.knowledge.search(filters); }
  approveKnowledge(id: string, input: KnowledgeApprovalInput): KnowledgeWithDetails { return this.knowledge.approve(id, input); }
  rejectKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails { return this.knowledge.reject(id, reviewer, comment); }
  archiveKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails { return this.knowledge.archive(id, reviewer, comment); }
  deprecateKnowledge(id: string, reviewer: string, comment?: string | null): KnowledgeWithDetails { return this.knowledge.deprecate(id, reviewer, comment); }
  recordKnowledgeUse(input: RecordKnowledgeUseInput): KnowledgeUse { return this.knowledge.recordUse(input); }
  listKnowledgeUses(knowledgeId: string, limit = 50, offset = 0): KnowledgeUse[] { return this.knowledge.uses(knowledgeId, limit, offset); }
  getKnowledgeGovernance(id: string): KnowledgeGovernance | null { return this.knowledge.getGovernance(id); }
  listKnowledgeGovernance(limit = 50, offset = 0): KnowledgeGovernance[] { return this.knowledge.listGovernance(limit, offset); }
  updateKnowledgeGovernance(id: string, input: KnowledgeGovernanceUpdateInput): KnowledgeGovernance { return this.knowledge.updateGovernance(id, input); }

  createKnowledgeLibraryEntry(input: CreateKnowledgeLibraryInput): KnowledgeLibraryEntry { return this.knowledgeLibrary.create(input); }
  getKnowledgeLibraryEntry(id: string): KnowledgeLibraryEntry | null { return this.knowledgeLibrary.get(id); }
  listKnowledgeLibrary(filters: KnowledgeLibraryListFilters = {}): KnowledgeLibrarySearchResult[] { return this.knowledgeLibrary.list(filters); }
  searchKnowledgeLibrary(filters: KnowledgeLibraryListFilters): KnowledgeLibrarySearchResult[] { return this.knowledgeLibrary.search(filters); }
  getKnowledgeLibraryKindSummaries(projectId?: string | null): KnowledgeLibraryKindSummary[] { return this.knowledgeLibrary.kindSummaries(projectId); }
  updateKnowledgeLibraryEntry(id: string, updates: UpdateKnowledgeLibraryInput): KnowledgeLibraryEntry { return this.knowledgeLibrary.update(id, updates); }
  deprecateKnowledgeLibraryEntry(id: string): KnowledgeLibraryEntry { return this.knowledgeLibrary.deprecate(id); }

  // ── Feature ──────────────────────────────────────────────────────

  createFeature(input: { id: string; projectId: string; title: string; summary?: string | null; taskAnchor?: string | null; roleSnailMapping?: Record<string, Record<string, string>> }): Feature {
    this.db.prepare(
      "INSERT INTO feature (id, project_id, title, summary, task_anchor, role_snail_mapping) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.title, input.summary ?? null, input.taskAnchor ?? null, JSON.stringify(input.roleSnailMapping ?? {}));
    return this.getFeature(input.id)!;
  }

  getFeature(id: string): Feature | undefined {
    const row = this.db.prepare("SELECT * FROM feature WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapFeature(row) : undefined;
  }

  listFeatures(projectId: string): Feature[] {
    const rows = this.db.prepare("SELECT * FROM feature WHERE project_id = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC").all(projectId) as Record<string, unknown>[];
    return rows.map(mapFeature);
  }

  updateFeature(id: string, updates: Partial<Pick<Feature, "title" | "summary" | "task_anchor" | "closed_at" | "role_snail_mapping">>): Feature {
    const feature = this.getFeature(id);
    if (!feature) throw new Error(`Feature not found: ${id}`);
    this.db.prepare(
      "UPDATE feature SET title = ?, summary = ?, task_anchor = ?, closed_at = ?, role_snail_mapping = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? feature.title,
      updates.summary ?? feature.summary,
      updates.task_anchor ?? feature.task_anchor,
      updates.closed_at ?? feature.closed_at,
      updates.role_snail_mapping !== undefined ? JSON.stringify(updates.role_snail_mapping) : JSON.stringify(feature.role_snail_mapping),
      id
    );
    return this.getFeature(id)!;
  }

  // ── Stage ────────────────────────────────────────────────────────

  createStage(input: CreateStageInput): Stage {
    this.db.prepare(
      "INSERT INTO stage (id, project_id, feature_id, stage_definition_id, type, sequence, status, output_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.featureId, input.stageDefinitionId, input.type, input.sequence, input.status, JSON.stringify(input.outputArtifacts ?? {}), input.enteredAt ?? null);
    return this.getStage(input.id)!;
  }

  getStage(id: string): Stage | undefined {
    const row = this.db.prepare("SELECT * FROM stage WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapStage(row) : undefined;
  }

  listStages(projectId: string): Stage[] {
    const rows = this.db.prepare("SELECT * FROM stage WHERE project_id = ? ORDER BY sequence ASC").all(projectId) as Record<string, unknown>[];
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

  updateStage(id: string, updates: Partial<Pick<Stage, "status" | "output_artifacts" | "entered_at" | "left_at">>): Stage {
    const stage = this.getStage(id);
    if (!stage) throw new Error(`Stage not found: ${id}`);
    this.db.prepare(
      "UPDATE stage SET status = ?, output_artifacts = ?, entered_at = ?, left_at = ? WHERE id = ?"
    ).run(
      updates.status ?? stage.status,
      JSON.stringify(updates.output_artifacts ?? stage.output_artifacts),
      updates.entered_at ?? stage.entered_at,
      updates.left_at ?? stage.left_at,
      id
    );
    return this.getStage(id)!;
  }

  // ── Conversation ─────────────────────────────────────────────────

  createConversation(input: CreateConversationInput): Conversation {
    this.db.prepare(
      "INSERT INTO conversation (id, project_id, feature_id, stage_id, owner_type, owner_id, title, kind, status, default_role, participating_roles, summary, from_conversation_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)"
    ).run(
      input.id,
      input.projectId,
      input.featureId,
      input.stageId,
      input.ownerType ?? "project_stage",
      input.ownerId ?? input.stageId,
      input.title,
      input.kind,
      input.defaultRole,
      JSON.stringify(input.participatingRoles),
      input.summary ?? null,
      JSON.stringify(input.fromConversationIds ?? [])
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

  listConversationsByOwner(ownerType: string, ownerId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE owner_type = ? AND owner_id = ? ORDER BY updated_at DESC").all(ownerType, ownerId) as Record<string, unknown>[];
    return rows.map(mapConversation);
  }

  getInitialConversationByStage(stageId: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversation WHERE stage_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1").get(stageId) as Record<string, unknown> | undefined;
    return row ? mapConversation(row) : undefined;
  }

  updateConversation(id: string, updates: Partial<Pick<Conversation, "status" | "summary" | "from_conversation_ids" | "participating_roles" | "title">>): Conversation {
    const conversation = this.getConversation(id);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    this.db.prepare(
      "UPDATE conversation SET title = ?, status = ?, participating_roles = ?, summary = ?, from_conversation_ids = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? conversation.title,
      updates.status ?? conversation.status,
      JSON.stringify(updates.participating_roles ?? conversation.participating_roles),
      updates.summary ?? conversation.summary,
      JSON.stringify(updates.from_conversation_ids ?? conversation.from_conversation_ids),
      id
    );
    return this.getConversation(id)!;
  }

  // ── Message ──────────────────────────────────────────────────────

  addMessage(input: CreateMessageInput): Message {
    const insert = this.db.prepare(
      "INSERT INTO message (conversation_id, client_id, from_role, to_roles, role, quoted_message_id, context_cutoff_at, runtime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const updateConversation = this.db.prepare("UPDATE conversation SET updated_at = datetime('now') WHERE id = ?");
    const updateProject = this.db.prepare("UPDATE project SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM conversation WHERE id = ? AND project_id IS NOT NULL)");
    const updateFeature = this.db.prepare("UPDATE feature SET updated_at = datetime('now') WHERE id = (SELECT feature_id FROM conversation WHERE id = ? AND feature_id IS NOT NULL)");

    const transaction = this.db.transaction((payload: CreateMessageInput) => {
      insert.run(
        payload.conversationId,
        payload.clientId ?? null,
        payload.fromRole,
        JSON.stringify(payload.toRoles ?? []),
        payload.role,
        payload.quotedMessageId ?? null,
        payload.contextCutoffAt ?? "0",
        payload.runtime ?? null,
        payload.status ?? (payload.role === "assistant" ? "streaming" : "completed")
      );
      const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
      for (const toRole of payload.toRoles ?? []) {
        this.db.prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_role) VALUES (?, ?, ?)").run(payload.conversationId, id, toRole);
      }
      updateConversation.run(payload.conversationId);
      updateProject.run(payload.conversationId);
      updateFeature.run(payload.conversationId);
      return id;
    });

    const id = transaction(input) as number;
    return this.getMessage(id)!;
  }

  addMessageEvent(messageId: number, event: CreateMessageEventInput, _conversationId?: string): MessageEvent {
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

  completeMessageWithEvent(messageId: number, event: CreateMessageEventInput, status: Exclude<MessageStatus, "streaming">, _conversationId?: string): MessageEvent {
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

  upsertMessageContext(messageId: number, kind: MessageContextKind, context: string, _conversationId?: string): MessageContext {
    const message = this.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    const persisted = messageContextModel.upsertMessageContext({ db: this.db, messageId, kind, context });
    this.reindexMessage(messageId);
    return persisted;
  }

  getMessageContext(messageId: number, _conversationId?: string): MessageContext | null {
    return messageContextModel.getMessageContext(this.db, messageId);
  }

  updateMessageStatus(messageId: number, status: MessageStatus): void {
    this.db.prepare("UPDATE message SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, messageId);
  }

  getMessageEvents(messageId: number, _conversationId?: string): MessageEvent[] {
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
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId, conversationId), (messageId) => this.getMessageContext(messageId, conversationId));
  }

  getRecentMessages(conversationId: string, limit = 5): MessageWithEvents[] { return messageReadModel.getRecentMessages({ db: this.db, conversationId, limit, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getLatestMessage(conversationId: string): MessageWithEvents | null { return messageReadModel.getLatestMessage({ db: this.db, conversationId, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getLatestRespondingRole(conversationId: string, participatingRoles: RoleName[]): RoleName | null { return messageReadModel.getLatestRespondingRole({ db: this.db, conversationId, participatingRoles }); }

  getRecentMessagesSnapshot(conversationId: string, limit = 5, beforeCursorHook?: (snapshotEventId: number) => void): messageReadModel.RecentMessagesSnapshot { return messageReadModel.getRecentMessagesSnapshot({ db: this.db, conversationId, limit, beforeCursorHook }); }
  getLastMessageEventId(conversationId: string): number { return messageReadModel.getLastMessageEventId(this.db, conversationId); }
  getMessageEventsAfter(conversationId: string, afterEventId: number, untilEventId: number | null = null): messageReadModel.ConversationEventWithMessage[] { return messageReadModel.getMessageEventsAfter(this.db, conversationId, afterEventId, untilEventId); }

  getRecentConversationMessagesWindow(conversationId: string, userMessageCount = 3): MessageWithEvents[] {
    const normalizedMessageCount = Math.max(1, userMessageCount);
    const anchorRow = this.db.prepare(`SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 1 OFFSET ?`).get(conversationId, normalizedMessageCount - 1) as { id: number } | undefined;
    if (!anchorRow) return this.getMessages(conversationId);
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id >= ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorRow.id) as Record<string, unknown>[];
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId, conversationId), (messageId) => this.getMessageContext(messageId, conversationId));
  }

  getMessagesSinceRoleReply(conversationId: string, roleName: string): MessageWithEvents[] { return messageReadModel.getMessagesSinceRoleReply({ db: this.db, conversationId, roleName, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getDispatchInboxMessages(conversationId: string, roleName: string, dispatchSourceMessageIds: number[]): MessageWithEvents[] { return messageReadModel.getDispatchInboxMessages({ db: this.db, conversationId, roleName, dispatchSourceMessageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getMessagesByIds(conversationId: string, messageIds: number[]): MessageWithEvents[] { return messageReadModel.getMessagesByIds({ db: this.db, conversationId, messageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): MessageWithEvents[] { return messageReadModel.getMessageWindow({ db: this.db, conversationId, anchorMessageId, before, after, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  searchConversationMessages(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchResult[] { return messageReadModel.searchConversationMessages({ db: this.db, conversationId, query, limit, offset }); }

  // ── Message Dispatch ─────────────────────────────────────────────

  addMessageDispatch(input: CreateMessageDispatchInput): MessageDispatch {
    this.db.prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_role) VALUES (?, ?, ?)").run(input.conversationId, input.messageId, input.toRole);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.db.prepare("SELECT * FROM message_dispatch WHERE id = ?").get(id) as MessageDispatch;
  }

  rebuildDispatchesForMessage(messageId: number, _conversationId?: string): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("DELETE FROM message_dispatch WHERE message_id = ?").run(messageId);
    for (const toRole of message.to_roles) {
      this.addMessageDispatch({ conversationId: message.conversation_id, messageId: message.id, toRole });
    }
  }

  updateMessageRouting(messageId: number, toRoles: RoleName[], _conversationId?: string): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("UPDATE message SET to_roles = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(toRoles), messageId);
    this.rebuildDispatchesForMessage(messageId, _conversationId);
  }

  listPendingDispatches(conversationId: string, toRole?: RoleName): MessageDispatch[] {
    if (toRole) {
      return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_role = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, toRole) as MessageDispatch[];
    }
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
  }

  listDispatches(conversationId: string): MessageDispatch[] {
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
  }

  listDispatchInboxGroups(conversationId: string): DispatchInboxGroup[] {
    const rows = this.db.prepare(`SELECT to_role, status, GROUP_CONCAT(id) as dispatch_ids, GROUP_CONCAT(message_id) as message_ids, MAX(created_at) as latest_dispatch_at FROM message_dispatch WHERE conversation_id = ? GROUP BY to_role, status ORDER BY datetime(latest_dispatch_at) ASC, to_role ASC`).all(conversationId) as Array<{ to_role: RoleName; status: "pending" | "seen" | "consumed" | "skipped"; dispatch_ids: string; message_ids: string; latest_dispatch_at: string }>;
    return rows.map((row) => ({ to_role: row.to_role, status: row.status, dispatch_ids: row.dispatch_ids.split(",").map(Number).filter(Number.isInteger), message_ids: row.message_ids.split(",").map(Number).filter(Number.isInteger), latest_dispatch_at: row.latest_dispatch_at }));
  }

  markDispatchesConsumed(dispatchIds: number[], consumedByMessageId: number | null = null): void {
    markProjectDispatchesConsumed(this.db, dispatchIds, consumedByMessageId);
  }

  markConversationDispatchesConsumed(conversationId: string, dispatchIds: number[], consumedByMessageId: number | null = null): void {
    this.markDispatchesConsumed(dispatchIds, consumedByMessageId);
  }

  markDispatchesSeen(dispatchIds: number[]): void {
    markProjectDispatchesSeen(this.db, dispatchIds);
  }

  markConversationDispatchesSeen(conversationId: string, dispatchIds: number[]): void {
    this.markDispatchesSeen(dispatchIds);
  }

  skipDispatches(dispatchIds: number[]): void {
    skipProjectDispatches(this.db, dispatchIds);
  }

  skipConversationDispatches(conversationId: string, dispatchIds: number[]): void {
    this.skipDispatches(dispatchIds);
  }

  listBossPendingDispatches(conversationId: string): MessageDispatch[] {
    return listProjectBossPendingDispatches(this.db, conversationId);
  }

  // ── Snail Agent Session ──────────────────────────────────────────

  createSnailAgentSession(input: { id: string; conversationId: string; roleName: string; runtime: string; model: string; contextProvider: "shell" | "agent"; externalSessionId?: string | null; handoffFromId?: string | null }): SnailAgentSession {
    if (input.contextProvider === "agent" && input.runtime === "claude-code-cli") {
      throw new Error(`contextProvider "agent" requires a stateful runtime, but "claude-code-cli" is stateless (role "${input.roleName}")`);
    }
    this.db.prepare(
      "INSERT INTO snail_agent_session (id, conversation_id, role_name, runtime, model, context_provider, external_session_id, handoff_from_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.conversationId, input.roleName, input.runtime, input.model, input.contextProvider, input.externalSessionId ?? null, input.handoffFromId ?? null);
    return this.getCurrentSnailAgentSession(input.conversationId, input.roleName)!;
  }

  getCurrentSnailAgentSession(conversationId: string, roleName: string): SnailAgentSession | null {
    const row = this.db.prepare(
      "SELECT * FROM snail_agent_session WHERE conversation_id = ? AND role_name = ? ORDER BY created_at DESC LIMIT 1"
    ).get(conversationId, roleName) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      role_name: row.role_name as string,
      runtime: row.runtime as string,
      model: row.model as string,
      context_provider: row.context_provider as "shell" | "agent",
      external_session_id: row.external_session_id as string | null,
      handoff_from_id: row.handoff_from_id as string | null,
      created_at: row.created_at as string,
    };
  }

  updateSnailAgentSessionExternalId(sessionId: string, externalSessionId: string | null): void {
    this.db.prepare("UPDATE snail_agent_session SET external_session_id = ? WHERE id = ?").run(externalSessionId, sessionId);
  }

  // ── Search ───────────────────────────────────────────────────────

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
    this.db.prepare("INSERT INTO message_search (conversation_id, message_id, role, from_role, content) VALUES (?, ?, ?, ?, ?)").run(message.conversation_id, String(message.id), message.role, message.from_role, content);
  }

  close(): void { this.db.close(); }
}
