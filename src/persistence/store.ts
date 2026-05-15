import Database from "better-sqlite3";
import path from "path";
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
import { DesignDecisionModel } from "./design-decision-model";
import { listProjectBossPendingDispatches, markProjectDispatchesConsumed, markProjectDispatchesSeen, skipProjectDispatches } from "./dispatch-store";
import * as governanceConversationModel from "./knowledge-governance-conversation-model";
import * as messageReadModel from "./message-read-model";
import * as messageContextModel from "./message-context-model";
import { ensureConversationOwnerColumns, tableExists } from "./migrations";
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
  FeatureStatus,
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
  SnailName,
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
  ProjectStageDefinition,
  SnailName,
  Stage,
  StageRoleDefinition,
} from "./types";
export type { StageType } from "./types";
export type { CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeGovernance, KnowledgeGovernanceUpdateInput, KnowledgeItem, KnowledgeKind, KnowledgeListFilters, KnowledgeScopeType, KnowledgeSearchResult, KnowledgeSource, KnowledgeStatus, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";
import type { CreateKnowledgeInput, KnowledgeApprovalInput, KnowledgeGovernance, KnowledgeGovernanceUpdateInput, KnowledgeListFilters, KnowledgeSearchResult, KnowledgeUse, KnowledgeWithDetails, RecordKnowledgeUseInput } from "./knowledge-types";
export type { CreateDesignDecisionInput, DesignDecision, DesignDecisionListFilters, DesignDecisionSearchResult, DesignDecisionStatus, UpdateDesignDecisionInput } from "../shared/design-decision-types";
import type { CreateDesignDecisionInput, DesignDecision, DesignDecisionListFilters, DesignDecisionSearchResult, UpdateDesignDecisionInput } from "../shared/design-decision-types";

export class ConversationStore {
  private db: Database.Database;
  private knowledge: KnowledgeModel;
  private designDecision: DesignDecisionModel;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "snail-shell.db");
    const dir = path.dirname(resolvedPath);
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.knowledge = new KnowledgeModel(this.db);
    this.designDecision = new DesignDecisionModel(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(SCHEMA_SQL);
    this.ensureMessageClientIdColumn();
    ensureConversationOwnerColumns(this.db);
    this.ensureKnowledgeGovernanceRuntimeColumns();
  }

  private ensureMessageClientIdColumn(): void {
    if (!tableExists(this.db, "message")) return;
    const columns = this.db.prepare("PRAGMA table_info(message)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "client_id")) {
      this.db.exec("ALTER TABLE message ADD COLUMN client_id TEXT");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_message_conversation_client_id ON message(conversation_id, client_id)");
  }

  private ensureKnowledgeGovernanceRuntimeColumns(): void {
    if (!tableExists(this.db, "knowledge_governance")) return;
    const columns = this.db.prepare("PRAGMA table_info(knowledge_governance)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "runtime_feedback_allowed")) {
      this.db.exec("ALTER TABLE knowledge_governance ADD COLUMN runtime_feedback_allowed INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "runtime_feedback_channels")) {
      this.db.exec("ALTER TABLE knowledge_governance ADD COLUMN runtime_feedback_channels TEXT NOT NULL DEFAULT '[]'");
    }
  }

  private isKnowledgeGovernanceConversation(conversationId: string): boolean {
    return governanceConversationModel.knowledgeGovernanceConversationExists(this.db, conversationId);
  }

  private getMessageConversationId(messageId: number): string | null {
    const projectRow = this.db.prepare("SELECT conversation_id FROM message WHERE id = ?").get(messageId) as { conversation_id: string } | undefined;
    if (projectRow) return projectRow.conversation_id;
    const governanceRow = this.db.prepare("SELECT conversation_id FROM knowledge_governance_message WHERE id = ?").get(messageId) as { conversation_id: string } | undefined;
    return governanceRow?.conversation_id ?? null;
  }

  private isKnowledgeGovernanceMessage(messageId: number, conversationId?: string): boolean {
    if (conversationId) return this.isKnowledgeGovernanceConversation(conversationId);
    const resolvedConversationId = this.getMessageConversationId(messageId);
    return resolvedConversationId ? this.isKnowledgeGovernanceConversation(resolvedConversationId) : false;
  }

  // ── Project Config Seed ──────────────────────────────────────────

  seedProjectConfig(seed: projectConfigModel.ProjectConfigSeed): { created: boolean } {
    return projectConfigModel.seedProjectConfig(this.db, seed);
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

  createProject(id: string, kind: ProjectKind, name: string, summary?: string): Project {
    this.db.prepare("INSERT INTO project (id, kind, name, summary, status) VALUES (?, ?, ?, ?, 'active')").run(id, kind, name, summary ?? null);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | undefined { return this.db.prepare("SELECT * FROM project WHERE id = ?").get(id) as Project | undefined; }

  findProjectByNameAndKind(name: string, kind: ProjectKind): Project | undefined {
    return this.db.prepare("SELECT * FROM project WHERE name = ? AND kind = ? ORDER BY created_at ASC LIMIT 1").get(name, kind) as Project | undefined;
  }

  listProjects(limit = 50, offset = 0): Project[] { return this.db.prepare("SELECT * FROM project ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Project[]; }

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

  createDesignDecision(input: CreateDesignDecisionInput): DesignDecision { return this.designDecision.create(input); }
  getDesignDecision(id: string): DesignDecision | null { return this.designDecision.get(id); }
  listDesignDecisions(filters: DesignDecisionListFilters = {}): DesignDecisionSearchResult[] { return this.designDecision.list(filters); }
  searchDesignDecisions(filters: DesignDecisionListFilters): DesignDecisionSearchResult[] { return this.designDecision.search(filters); }
  updateDesignDecision(id: string, updates: UpdateDesignDecisionInput): DesignDecision { return this.designDecision.update(id, updates); }
  deprecateDesignDecision(id: string): DesignDecision { return this.designDecision.deprecate(id); }

  // ── Feature ──────────────────────────────────────────────────────

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

  // ── Stage ────────────────────────────────────────────────────────

  createStage(input: CreateStageInput): Stage {
    this.db.prepare(
      "INSERT INTO stage (id, project_id, feature_id, stage_definition_id, type, sequence, status, input_artifacts, output_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.featureId, input.stageDefinitionId, input.type, input.sequence, input.status, JSON.stringify(input.inputArtifacts ?? []), JSON.stringify(input.outputArtifacts ?? []), input.enteredAt ?? null);
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

  updateStage(id: string, updates: Partial<Pick<Stage, "status" | "input_artifacts" | "output_artifacts" | "entered_at" | "left_at">>): Stage {
    const stage = this.getStage(id);
    if (!stage) throw new Error(`Stage not found: ${id}`);
    this.db.prepare(
      "UPDATE stage SET status = ?, input_artifacts = ?, output_artifacts = ?, entered_at = ?, left_at = ? WHERE id = ?"
    ).run(
      updates.status ?? stage.status,
      JSON.stringify(updates.input_artifacts ?? stage.input_artifacts),
      JSON.stringify(updates.output_artifacts ?? stage.output_artifacts),
      updates.entered_at ?? stage.entered_at,
      updates.left_at ?? stage.left_at,
      id
    );
    return this.getStage(id)!;
  }

  // ── Conversation ─────────────────────────────────────────────────

  createConversation(input: CreateConversationInput): Conversation {
    if (input.ownerType === "knowledge_governance") {
      throw new Error("Use knowledge governance persistence helpers to create governance conversations");
    }
    this.db.prepare(
      "INSERT INTO conversation (id, project_id, feature_id, stage_id, owner_type, owner_id, title, kind, status, default_snail, participating_snails, summary, from_conversation_ids, runtime_sessions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)"
    ).run(
      input.id,
      input.projectId,
      input.featureId,
      input.stageId,
      input.ownerType ?? "project_stage",
      input.ownerId ?? input.stageId,
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
    const governanceConversation = governanceConversationModel.getConversation(this.db, id); if (governanceConversation) return governanceConversation;
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

  updateConversation(id: string, updates: Partial<Pick<Conversation, "status" | "summary" | "from_conversation_ids" | "participating_snails" | "title" | "runtime_sessions">>): Conversation {
    const conversation = this.getConversation(id);
    if (!conversation) throw new Error(`Conversation not found: ${id}`);
    if (governanceConversationModel.knowledgeGovernanceConversationExists(this.db, id)) {
      const runtimeSessions = updates.runtime_sessions ?? conversation.runtime_sessions;
      this.db.prepare("UPDATE knowledge_governance_conversation SET title = ?, status = ?, participating_snails = ?, summary = ?, from_conversation_ids = ?, runtime_sessions = ?, updated_at = datetime('now') WHERE id = ?").run(
        updates.title ?? conversation.title,
        updates.status ?? conversation.status,
        JSON.stringify(updates.participating_snails ?? conversation.participating_snails),
        updates.summary ?? conversation.summary,
        JSON.stringify(updates.from_conversation_ids ?? conversation.from_conversation_ids),
        JSON.stringify(runtimeSessions),
        id
      );
      return this.getConversation(id)!;
    }
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

  // ── Message ──────────────────────────────────────────────────────

  addMessage(input: CreateMessageInput): Message {
    if (this.isKnowledgeGovernanceConversation(input.conversationId)) return governanceConversationModel.addMessage(this.db, input);
    const insert = this.db.prepare(
      "INSERT INTO message (conversation_id, client_id, from_snail, to_snails, role, quoted_message_id, context_cutoff_at, runtime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const updateConversation = this.db.prepare("UPDATE conversation SET updated_at = datetime('now') WHERE id = ?");
    const updateProject = this.db.prepare("UPDATE project SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM conversation WHERE id = ? AND project_id IS NOT NULL)");
    const updateFeature = this.db.prepare("UPDATE feature SET updated_at = datetime('now') WHERE id = (SELECT feature_id FROM conversation WHERE id = ? AND feature_id IS NOT NULL)");

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

  addMessageEvent(messageId: number, event: CreateMessageEventInput, conversationId?: string): MessageEvent {
    conversationId = conversationId ?? this.getMessageConversationId(messageId) ?? undefined;
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.addMessageEvent(this.db, messageId, event, conversationId);
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

  completeMessageWithEvent(messageId: number, event: CreateMessageEventInput, status: Exclude<MessageStatus, "streaming">, conversationId?: string): MessageEvent {
    conversationId = conversationId ?? this.getMessageConversationId(messageId) ?? undefined;
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.completeMessageWithEvent(this.db, { messageId, event, status, conversationId });
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

  upsertMessageContext(messageId: number, kind: MessageContextKind, context: string, conversationId?: string): MessageContext {
    conversationId = conversationId ?? this.getMessageConversationId(messageId) ?? undefined;
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.upsertMessageContext(this.db, messageId, kind, context);
    const message = this.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    const persisted = messageContextModel.upsertMessageContext({ db: this.db, messageId, kind, context });
    this.reindexMessage(messageId);
    return persisted;
  }

  getMessageContext(messageId: number, conversationId?: string): MessageContext | null {
    conversationId = conversationId ?? this.getMessageConversationId(messageId) ?? undefined;
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.getMessageContext(this.db, messageId);
    return messageContextModel.getMessageContext(this.db, messageId);
  }

  updateMessageStatus(messageId: number, status: MessageStatus): void {
    const conversationId = this.getMessageConversationId(messageId);
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) { this.db.prepare("UPDATE knowledge_governance_message SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, messageId); return; }
    this.db.prepare("UPDATE message SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, messageId);
  }

  getMessageEvents(messageId: number, conversationId?: string): MessageEvent[] {
    conversationId = conversationId ?? this.getMessageConversationId(messageId) ?? undefined;
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.getMessageEvents(this.db, messageId);
    const rows = this.db.prepare("SELECT * FROM message_event WHERE message_id = ? ORDER BY seq ASC").all(messageId) as PersistedMessageEventRow[];
    return rows.map(mapMessageEvent);
  }

  getMessage(messageId: number, conversationId?: string): Message | null {
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.getMessage(this.db, messageId, conversationId);
    if (!conversationId) {
      const resolvedConversationId = this.getMessageConversationId(messageId);
      if (resolvedConversationId && this.isKnowledgeGovernanceConversation(resolvedConversationId)) return governanceConversationModel.getMessage(this.db, messageId, resolvedConversationId);
    }
    const query = conversationId ? "SELECT * FROM message WHERE id = ? AND conversation_id = ?" : "SELECT * FROM message WHERE id = ?";
    const params = conversationId ? [messageId, conversationId] : [messageId];
    const row = this.db.prepare(query).get(...params) as Record<string, unknown> | undefined;
    return row ? mapMessage(row) : null;
  }

  listStreamingAssistantMessages(): Message[] {
    const projectRows = this.db.prepare("SELECT * FROM message WHERE role = 'assistant' AND status = 'streaming' ORDER BY datetime(created_at) ASC, id ASC").all() as Record<string, unknown>[];
    const governanceRows = governanceConversationModel.listStreamingAssistantMessages(this.db);
    return [...projectRows.map(mapMessage), ...governanceRows].sort((left, right) => {
      const createdAtCompare = left.created_at.localeCompare(right.created_at);
      if (createdAtCompare !== 0) return createdAtCompare;
      return left.id - right.id;
    });
  }

  getMessages(conversationId: string, limit = 100, offset = 0): MessageWithEvents[] {
    if (this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.getMessages(this.db, conversationId, limit, offset);
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?").all(conversationId, limit, offset) as Record<string, unknown>[];
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId, conversationId), (messageId) => this.getMessageContext(messageId, conversationId));
  }

  getRecentMessages(conversationId: string, limit = 5): MessageWithEvents[] { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getMessages(this.db, conversationId, limit, 0) : messageReadModel.getRecentMessages({ db: this.db, conversationId, limit, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getLatestMessage(conversationId: string): MessageWithEvents | null { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getLatestMessage(this.db, conversationId) : messageReadModel.getLatestMessage({ db: this.db, conversationId, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getLatestRespondingSnail(conversationId: string, participatingSnails: SnailName[]): SnailName | null { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getLatestRespondingSnail(this.db, conversationId, participatingSnails) : messageReadModel.getLatestRespondingSnail({ db: this.db, conversationId, participatingSnails }); }

  getRecentMessagesSnapshot(conversationId: string, limit = 5, beforeCursorHook?: (snapshotEventId: number) => void): messageReadModel.RecentMessagesSnapshot { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getRecentMessagesSnapshot(this.db, conversationId, limit, beforeCursorHook) : messageReadModel.getRecentMessagesSnapshot({ db: this.db, conversationId, limit, beforeCursorHook }); }
  getLastMessageEventId(conversationId: string): number { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getLastMessageEventId(this.db, conversationId) : messageReadModel.getLastMessageEventId(this.db, conversationId); }
  getMessageEventsAfter(conversationId: string, afterEventId: number, untilEventId: number | null = null): messageReadModel.ConversationEventWithMessage[] { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getMessageEventsAfter(this.db, conversationId, afterEventId, untilEventId) : messageReadModel.getMessageEventsAfter(this.db, conversationId, afterEventId, untilEventId); }

  getRecentConversationMessagesWindow(conversationId: string, userMessageCount = 3): MessageWithEvents[] {
    if (this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.getRecentConversationMessagesWindow(this.db, conversationId, userMessageCount);
    const normalizedMessageCount = Math.max(1, userMessageCount);
    const anchorRow = this.db.prepare(`SELECT id FROM message WHERE conversation_id = ? AND role = 'user' ORDER BY datetime(created_at) DESC, id DESC LIMIT 1 OFFSET ?`).get(conversationId, normalizedMessageCount - 1) as { id: number } | undefined;
    if (!anchorRow) return this.getMessages(conversationId);
    const rows = this.db.prepare("SELECT * FROM message WHERE conversation_id = ? AND id >= ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, anchorRow.id) as Record<string, unknown>[];
    return attachMessageEvents(rows.map(mapMessage), (messageId) => this.getMessageEvents(messageId, conversationId), (messageId) => this.getMessageContext(messageId, conversationId));
  }

  getMessagesSinceSnailReply(conversationId: string, snailName: string): MessageWithEvents[] { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getMessagesSinceSnailReply(this.db, conversationId, snailName) : messageReadModel.getMessagesSinceSnailReply({ db: this.db, conversationId, snailName, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getDispatchInboxMessages(conversationId: string, snailName: string, dispatchSourceMessageIds: number[]): MessageWithEvents[] { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getDispatchInboxMessages(this.db, conversationId, snailName, dispatchSourceMessageIds) : messageReadModel.getDispatchInboxMessages({ db: this.db, conversationId, snailName, dispatchSourceMessageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getMessagesByIds(conversationId: string, messageIds: number[]): MessageWithEvents[] { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getMessagesByIds(this.db, conversationId, messageIds) : messageReadModel.getMessagesByIds({ db: this.db, conversationId, messageIds, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  getMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): MessageWithEvents[] { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.getMessageWindow({ db: this.db, conversationId, anchorMessageId, before, after }) : messageReadModel.getMessageWindow({ db: this.db, conversationId, anchorMessageId, before, after, getMessageEvents: (messageId) => this.getMessageEvents(messageId, conversationId) }); }
  searchConversationMessages(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchResult[] { return this.isKnowledgeGovernanceConversation(conversationId) ? governanceConversationModel.searchConversationMessages({ db: this.db, conversationId, query, limit, offset }) : messageReadModel.searchConversationMessages({ db: this.db, conversationId, query, limit, offset }); }

  // ── Message Dispatch ─────────────────────────────────────────────

  addMessageDispatch(input: CreateMessageDispatchInput): MessageDispatch {
    if (this.isKnowledgeGovernanceConversation(input.conversationId)) {
      this.db.prepare("INSERT INTO knowledge_governance_message_dispatch (conversation_id, message_id, to_snail) VALUES (?, ?, ?)").run(input.conversationId, input.messageId, input.toSnail);
      const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
      return governanceConversationModel.listDispatches(this.db, input.conversationId).find((dispatch) => dispatch.id === id)!;
    }
    this.db.prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_snail) VALUES (?, ?, ?)").run(input.conversationId, input.messageId, input.toSnail);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.db.prepare("SELECT * FROM message_dispatch WHERE id = ?").get(id) as MessageDispatch;
  }

  rebuildDispatchesForMessage(messageId: number, conversationId?: string): void {
    conversationId = conversationId ?? this.getMessageConversationId(messageId) ?? undefined;
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) {
      const message = this.getMessage(messageId, conversationId);
      if (!message) return;
      this.db.prepare("DELETE FROM knowledge_governance_message_dispatch WHERE message_id = ?").run(messageId);
      for (const toSnail of message.to_snails) this.addMessageDispatch({ conversationId: message.conversation_id, messageId: message.id, toSnail });
      return;
    }
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("DELETE FROM message_dispatch WHERE message_id = ?").run(messageId);
    for (const toSnail of message.to_snails) {
      this.addMessageDispatch({ conversationId: message.conversation_id, messageId: message.id, toSnail });
    }
  }

  updateMessageRouting(messageId: number, toSnails: SnailName[], conversationId?: string): void {
    conversationId = conversationId ?? this.getMessageConversationId(messageId) ?? undefined;
    if (conversationId && this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.updateMessageRouting(this.db, messageId, toSnails, conversationId);
    const message = this.getMessage(messageId);
    if (!message) return;
    this.db.prepare("UPDATE message SET to_snails = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(toSnails), messageId);
    this.rebuildDispatchesForMessage(messageId, conversationId);
  }

  listPendingDispatches(conversationId: string, toSnail?: SnailName): MessageDispatch[] {
    if (this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.listPendingDispatches(this.db, conversationId, toSnail);
    if (toSnail) {
      return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_snail = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId, toSnail) as MessageDispatch[];
    }
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
  }

  listDispatches(conversationId: string): MessageDispatch[] {
    if (this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.listDispatches(this.db, conversationId);
    return this.db.prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as MessageDispatch[];
  }

  listDispatchInboxGroups(conversationId: string): DispatchInboxGroup[] {
    if (this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.listDispatchInboxGroups(this.db, conversationId);
    const rows = this.db.prepare(`SELECT to_snail, status, GROUP_CONCAT(id) as dispatch_ids, GROUP_CONCAT(message_id) as message_ids, MAX(created_at) as latest_dispatch_at FROM message_dispatch WHERE conversation_id = ? GROUP BY to_snail, status ORDER BY datetime(latest_dispatch_at) ASC, to_snail ASC`).all(conversationId) as Array<{ to_snail: SnailName; status: "pending" | "seen" | "consumed" | "skipped"; dispatch_ids: string; message_ids: string; latest_dispatch_at: string }>;
    return rows.map((row) => ({ to_snail: row.to_snail, status: row.status, dispatch_ids: row.dispatch_ids.split(",").map(Number).filter(Number.isInteger), message_ids: row.message_ids.split(",").map(Number).filter(Number.isInteger), latest_dispatch_at: row.latest_dispatch_at }));
  }

  markDispatchesConsumed(dispatchIds: number[], consumedByMessageId: number | null = null): void {
    markProjectDispatchesConsumed(this.db, dispatchIds, consumedByMessageId);
  }

  markConversationDispatchesConsumed(conversationId: string, dispatchIds: number[], consumedByMessageId: number | null = null): void {
    if (this.isKnowledgeGovernanceConversation(conversationId)) {
      governanceConversationModel.markDispatchesConsumed(this.db, dispatchIds, consumedByMessageId);
      return;
    }
    this.markDispatchesConsumed(dispatchIds, consumedByMessageId);
  }

  markDispatchesSeen(dispatchIds: number[]): void {
    markProjectDispatchesSeen(this.db, dispatchIds);
  }

  markConversationDispatchesSeen(conversationId: string, dispatchIds: number[]): void {
    if (this.isKnowledgeGovernanceConversation(conversationId)) {
      governanceConversationModel.markDispatchesSeen(this.db, dispatchIds);
      return;
    }
    this.markDispatchesSeen(dispatchIds);
  }

  skipDispatches(dispatchIds: number[]): void {
    skipProjectDispatches(this.db, dispatchIds);
  }

  skipConversationDispatches(conversationId: string, dispatchIds: number[]): void {
    if (this.isKnowledgeGovernanceConversation(conversationId)) {
      governanceConversationModel.skipDispatches(this.db, dispatchIds);
      return;
    }
    this.skipDispatches(dispatchIds);
  }

  listBossPendingDispatches(conversationId: string): MessageDispatch[] {
    if (this.isKnowledgeGovernanceConversation(conversationId)) return governanceConversationModel.listBossPendingDispatches(this.db, conversationId);
    return listProjectBossPendingDispatches(this.db, conversationId);
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
    this.db.prepare("INSERT INTO message_search (conversation_id, message_id, role, from_snail, content) VALUES (?, ?, ?, ?, ?)").run(message.conversation_id, String(message.id), message.role, message.from_snail, content);
  }

  close(): void { this.db.close(); }
}
