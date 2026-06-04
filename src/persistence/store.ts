import Database from "better-sqlite3";
import path from "path";
import {
  attachMessageEvents,
  buildSearchableMessageContent,
  defaultEventSource,
  eventCategoryForKind,
  mapConversation,
  mapIssue,
  mapMessage,
  mapMessageEvent,
  mapStage,
  serializeMessageEventPayload,
  serializeMessageEventSource,
} from "./helpers";
import { EvolutionModel } from "./evolution-model";
import { KnowledgeLibraryModel } from "./knowledge-library-model";
import { listWorkspaceBossPendingDispatches, markWorkspaceDispatchesConsumed, markWorkspaceDispatchesSeen, skipWorkspaceDispatches } from "./dispatch-store";
import * as messageReadModel from "./message-read-model";
import * as messageContextModel from "./message-context-model";
import { SCHEMA_SQL } from "./schema";
import { FileConfigStore } from "./file-config-store";
import { GuardProfileStore } from "./guard-profile-store";
import { LlmConfigStore } from "./llm-config-store";
import { LoggingConfigStore } from "./logging-config-store";
import { SnailDenStore } from "./snail-den-store";
import { FeishuConfigStore } from "./feishu-config-store";
import { rebuildFeatureChainIndex } from "../feature-chain/indexer";

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
  Issue,
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
  Workspace,
  WorkspaceModule,
  WorkspaceStageDefinition,
  RoleName,
  Stage,
  StageRoleDefinition,
  StageStatus,
  StartEventPayload,
  TextEventPayload,
  ToolCallEventPayload,
  ToolResultEventPayload,
  Sop,
  SopSeedItem,
  SopSnapshot,
  SopStageDefinition,
  SopTransition,
  WorkspaceSop,
  StageChecklistItem,
  StageGateArtifact,
  StageGateEvidence,
  RuntimeBinding,
  InvocationSubject,
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
  Issue,
  SopSnapshot,
  Message,
  MessageContext,
  MessageContextKind,
  MessageDispatch,
  MessageEvent,
  MessageStatus,
  MessageWithEvents,
  PersistedMessageEventRow,
  Workspace,
  WorkspaceModule,
  WorkspaceStageDefinition,
  WorkspaceSop,
  RoleName,
  Sop,
  SopStageDefinition,
  SopTransition,
  Stage,
  StageRoleDefinition,
} from "./types";
export type { StageType } from "./types";
export type { EvolutionItem, EvolutionItemWithConversation, CreateEvolutionItemInput, UpdateEvolutionItemInput, EvolutionItemListFilters, EvolutionItemSearchResult } from "../shared/evolution-types";
import type { CreateEvolutionItemInput, EvolutionItemListFilters, EvolutionItemSearchResult, EvolutionItemWithConversation, UpdateEvolutionItemInput } from "../shared/evolution-types";
export type { KnowledgeLibraryScope, CreateKnowledgeLibraryInput, KnowledgeLibraryEntry, KnowledgeLibraryListFilters, KnowledgeLibrarySearchResult, UpdateKnowledgeLibraryInput } from "../shared/knowledge-library-types";
import type { CreateKnowledgeLibraryInput, KnowledgeLibraryEntry, KnowledgeLibraryListFilters, KnowledgeLibrarySearchResult, UpdateKnowledgeLibraryInput } from "../shared/knowledge-library-types";

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
  private evolution: EvolutionModel;
  private knowledgeLibrary: KnowledgeLibraryModel;
  private fileConfigStore: FileConfigStore;
  private guardProfileStore: GuardProfileStore;
  private llmConfigStore: LlmConfigStore;
  private loggingConfigStore: LoggingConfigStore;
  private snailDenStore: SnailDenStore;
  private feishuConfigStore: FeishuConfigStore;

  constructor(dbPath?: string, configDir?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "snail-shell.db");
    const dir = path.dirname(resolvedPath);
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const resolvedConfigDir = configDir ?? path.join(process.cwd(), "config");

    this.db = new Database(resolvedPath);
    this.fileConfigStore = new FileConfigStore(process.cwd(), configDir);
    this.fileConfigStore.loadAll();
    this.guardProfileStore = new GuardProfileStore(resolvedConfigDir);
    this.llmConfigStore = new LlmConfigStore(resolvedConfigDir);
    this.loggingConfigStore = new LoggingConfigStore(resolvedConfigDir);
    this.snailDenStore = new SnailDenStore(resolvedConfigDir);
    this.feishuConfigStore = new FeishuConfigStore(resolvedConfigDir);
    this.evolution = new EvolutionModel(this.db, this.fileConfigStore);
    this.knowledgeLibrary = new KnowledgeLibraryModel(this.db);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  // ── Database Bootstrap ────────────────────────────────────────────

  /**
   * HARD RULE: initSchema() 在系统启动时调用，只允许 CREATE TABLE IF NOT EXISTS /
   * CREATE INDEX IF NOT EXISTS 这类纯新建操作。严禁任何数据修改、迁移、删除动作。
   * 原因：initSchema() 连接的是生产数据库，任何自动执行的非新建操作都可能造成
   * 不可恢复的数据损失（参考 2026-05-20 事故）。
   */
  private initSchema(): void {
    this.db.exec(SCHEMA_SQL);
  }

  // ── Workspace Config (file-backed via FileConfigStore) ─────────────

  /** @deprecated Config is now loaded from files in the constructor via FileConfigStore. */
  seedWorkspaceConfigs(_seed?: unknown): { created: boolean } {
    return { created: false };
  }
  seedWorkspaceToCache(input: { id: string; module: string; name: string; summary?: string; workspaceRoot?: string; sopBindings?: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }> }): void {
    this.fileConfigStore.seedWorkspace({ ...input, module: input.module as WorkspaceModule });
  }
  /** Test helper: create a SOP via the real API (writes YAML file). Idempotent — skips if already exists. */
  seedSopToCache(
    sopInput: { id: string; source: "platform" | "workspace"; sourceRef: string | null; key: string; name: string; description?: string | null; firstStage?: string | null },
    stageDefinitions: Array<{
      key: string; title: string; sequence: number;
      input_description?: string | null; output_description?: string | null;
      acceptance_focus?: string[]; acceptance_checklist?: Array<{ id: string; description: string; required: boolean }>;
      roles: Array<{ key: string; name: string; description?: string; handbook?: string | null; is_primary?: boolean; count?: number }>;
    }>,
    transitions?: Array<{ from: string; to: string; guard?: { type: string; config?: Record<string, unknown> } }>,
  ): void {
    if (this.getSop(sopInput.key)) return; // idempotent: skip if SOP YAML already on disk
    this.fileConfigStore.createPlatformSop({ key: sopInput.key, name: sopInput.name, description: sopInput.description ?? undefined, first_stage: sopInput.firstStage ?? undefined, stage_definitions: stageDefinitions, transitions });
  }
  replaceWorkspaceConfigs(
    workspaceId: string,
    input: {
      workspaceUpdate: { name: string; summary?: string };
      sopSeeds: Array<{
        sop: { id: string; source: "platform" | "workspace"; sourceRef: string | null; key: string; name: string; description?: string | null };
        stage_definitions: Array<{
          key: string; title: string; sequence: number;
          input_description?: string | null; output_description?: string | null;
          acceptance_focus?: string[]; acceptance_checklist?: Array<{ id: string; description: string; required: boolean }>;
          roles: Array<{ key: string; name: string; description?: string; handbook?: string | null; is_primary?: boolean; count?: number }>;
        }>;
      }>;
      workspaceBindings: Array<{ sop_id: string; is_default: boolean; role_bindings: Record<string, string | string[]> }>;
    },
  ): void {
    this.fileConfigStore.replaceWorkspaceConfigs(workspaceId, input);
  }

  // ── SOP (file-backed via FileConfigStore) ───────────────────────

  getSop(id: string): Sop | undefined { return this.fileConfigStore.getSop(id); }
  getSopByKey(source: "platform" | "workspace", key: string): Sop | undefined { return this.fileConfigStore.getSopByKey(source, key); }
  listSops(source?: "platform" | "workspace"): Sop[] { return this.fileConfigStore.listSops(source); }
  listSopsByWorkspace(workspaceId: string): Sop[] { return this.fileConfigStore.listSopsByWorkspace(workspaceId); }
  createPlatformSop(input: Parameters<typeof this.fileConfigStore.createPlatformSop>[0]): Sop { return this.fileConfigStore.createPlatformSop(input); }
  updatePlatformSop(sopId: string, input: Parameters<typeof this.fileConfigStore.updatePlatformSop>[1]): Sop { return this.fileConfigStore.updatePlatformSop(sopId, input); }
  deletePlatformSop(sopId: string): string[] { return this.fileConfigStore.deletePlatformSop(sopId); }

  // ── SOP Transition (file-backed via FileConfigStore) ────────────

  getSopTransitions(sopId: string): SopTransition[] { return this.fileConfigStore.getSopTransitions(sopId); }
  getForwardTransitions(sopId: string, fromStageKey: string): SopTransition[] { return this.fileConfigStore.getForwardTransitions(sopId, fromStageKey); }
  validateTransition(sopId: string, fromStageKey: string, toStageKey: string): SopTransition { return this.fileConfigStore.validateTransition(sopId, fromStageKey, toStageKey); }
  getSopStageDefinition(id: string): SopStageDefinition | undefined { return this.fileConfigStore.getSopStageDefinition(id); }
  getSopStageDefinitionByKey(sopId: string, key: string): SopStageDefinition | undefined { return this.fileConfigStore.getSopStageDefinitionByKey(sopId, key); }
  listSopStageDefinitions(sopId: string): SopStageDefinition[] { return this.fileConfigStore.listSopStageDefinitions(sopId); }
  listSopStageRoleDefinitions(stageDefinitionId: string): StageRoleDefinition[] { return this.fileConfigStore.listSopStageRoleDefinitions(stageDefinitionId); }
  listSopStageDefinitionsWithRoles(sopId: string): Array<SopStageDefinition & { roles: StageRoleDefinition[] }> { return this.fileConfigStore.listSopStageDefinitionsWithRoles(sopId); }
  collectSopRoleKeys(sopId: string): Set<string> { return this.fileConfigStore.collectSopRoleKeys(sopId); }
  getWorkspaceSop(workspaceId: string, sopId: string): WorkspaceSop | undefined { return this.fileConfigStore.getWorkspaceSop(workspaceId, sopId); }
  listWorkspaceSops(workspaceId: string): WorkspaceSop[] { return this.fileConfigStore.listWorkspaceSops(workspaceId); }
  getDefaultWorkspaceSop(workspaceId: string): WorkspaceSop | undefined { return this.fileConfigStore.getDefaultWorkspaceSop(workspaceId); }
  createWorkspaceSop(input: { id: string; workspaceId: string; sopId: string; isDefault: boolean; roleBindings: Record<string, string | string[]> }): WorkspaceSop { return this.fileConfigStore.createWorkspaceSop(input); }
  updateWorkspaceSop(workspaceId: string, sopId: string, updates: { isDefault?: boolean; roleBindings?: Record<string, string | string[]> }): WorkspaceSop { return this.fileConfigStore.updateWorkspaceSop(workspaceId, sopId, updates); }
  deleteWorkspaceSop(workspaceId: string, sopId: string): void { return this.fileConfigStore.deleteWorkspaceSop(workspaceId, sopId); }
  getStageDefinition(id: string): WorkspaceStageDefinition | undefined {
    return this.fileConfigStore.getStageDefinitionByWorkspace(id);
  }
  getStageDefinitionByKey(workspaceId: string, key: string): WorkspaceStageDefinition | undefined {
    return this.fileConfigStore.getStageDefinitionByKey(workspaceId, key);
  }
  listStageDefinitions(workspaceId: string): WorkspaceStageDefinition[] {
    return this.fileConfigStore.listStageDefinitions(workspaceId);
  }
  getRoleDefinition(id: string): StageRoleDefinition | undefined { return this.fileConfigStore.getRoleDefinitionByWorkspace(id); }
  listRoleDefinitions(stageDefinitionId: string): StageRoleDefinition[] { return this.fileConfigStore.listRoleDefinitionsByStage(stageDefinitionId); }
  listRoleDefinitionsByStageAndWorkspace(stageDefinitionId: string, workspaceId: string): StageRoleDefinition[] { return this.fileConfigStore.listRoleDefinitionsByStageAndWorkspace(stageDefinitionId, workspaceId); }
  listRoleDefinitionsByWorkspace(workspaceId: string): StageRoleDefinition[] { return this.fileConfigStore.listRoleDefinitionsByWorkspace(workspaceId); }
  listAllRoleDefinitions(): Array<StageRoleDefinition & { workspace_id: string }> { return this.fileConfigStore.listAllRoleDefinitions(); }
  createWorkspace(id: string, module: string, name: string, workspaceRoot: string, summary?: string, guardProfile?: Record<string, unknown> | null): Workspace {
    return this.fileConfigStore.createWorkspace({ id, module: module as WorkspaceModule, name, workspaceRoot, summary, guardProfile });
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.fileConfigStore.getWorkspace(id);
  }

  findWorkspaceByName(name: string): Workspace | undefined {
    return this.fileConfigStore.findWorkspaceByName(name);
  }

  listWorkspaces(limit = 50, offset = 0, module = "workspace_management"): Workspace[] {
    return this.fileConfigStore.listWorkspaces(limit, offset, module as WorkspaceModule);
  }

  // ── Evolution ────────────────────────────────────────────────────

  createEvolutionItem(input: CreateEvolutionItemInput): EvolutionItemWithConversation { return this.evolution.create(input); }
  getEvolutionItem(id: string): EvolutionItemWithConversation | null { return this.evolution.get(id); }
  listEvolutionItems(filters: EvolutionItemListFilters = {}): EvolutionItemSearchResult[] { return this.evolution.list(filters); }
  updateEvolutionItem(id: string, input: UpdateEvolutionItemInput): EvolutionItemWithConversation { return this.evolution.update(id, input); }
  createKnowledgeLibraryEntry(input: CreateKnowledgeLibraryInput): KnowledgeLibraryEntry { return this.knowledgeLibrary.create(input); }
  getKnowledgeLibraryEntry(id: string): KnowledgeLibraryEntry | null { return this.knowledgeLibrary.get(id); }
  listKnowledgeLibrary(filters: KnowledgeLibraryListFilters = {}): KnowledgeLibrarySearchResult[] { return this.knowledgeLibrary.list(filters); }
  searchKnowledgeLibrary(filters: KnowledgeLibraryListFilters): KnowledgeLibrarySearchResult[] { return this.knowledgeLibrary.search(filters); }
  updateKnowledgeLibraryEntry(id: string, updates: UpdateKnowledgeLibraryInput): KnowledgeLibraryEntry { return this.knowledgeLibrary.update(id, updates); }
  summaryKnowledgeLibrary(workspaceId?: string): { scope: string; count: number }[] { return this.knowledgeLibrary.summary(workspaceId); }
  createIssue(input: { id: string; workspaceId: string; title: string; summary?: string | null; taskAnchor?: string | null; adoptedSopId?: string | null; sopSnapshot?: SopSnapshot; roleSnailMapping?: Record<string, Record<string, string>> }): Issue {
    const snapshot = input.sopSnapshot ?? { sop_id: "", name: "", description: null, first_stage: null, shared_handbook: null, stage_definitions: [], transitions: [] };
    this.db.prepare(
      "INSERT INTO issue (id, workspace_id, title, summary, task_anchor, adopted_sop_id, sop_snapshot, role_snail_mapping) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.workspaceId, input.title, input.summary ?? null, input.taskAnchor ?? null, input.adoptedSopId ?? null, JSON.stringify(snapshot), JSON.stringify(input.roleSnailMapping ?? {}));
    return this.getIssue(input.id)!;
  }

  getIssue(id: string): Issue | undefined {
    const row = this.db.prepare("SELECT * FROM issue WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapIssue(row) : undefined;
  }

  listIssues(workspaceId: string): Issue[] {
    const rows = this.db.prepare("SELECT * FROM issue WHERE workspace_id = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC").all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapIssue);
  }

  updateIssue(id: string, updates: Partial<Pick<Issue, "title" | "summary" | "task_anchor" | "closed_at" | "role_snail_mapping">>): Issue {
    const issue = this.getIssue(id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    this.db.prepare(
      "UPDATE issue SET title = ?, summary = ?, task_anchor = ?, closed_at = ?, role_snail_mapping = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? issue.title,
      updates.summary ?? issue.summary,
      updates.task_anchor ?? issue.task_anchor,
      updates.closed_at ?? issue.closed_at,
      updates.role_snail_mapping !== undefined ? JSON.stringify(updates.role_snail_mapping) : JSON.stringify(issue.role_snail_mapping),
      id
    );
    return this.getIssue(id)!;
  }

  createStage(input: CreateStageInput): Stage {
    this.db.prepare(
      "INSERT INTO stage (id, workspace_id, issue_id, stage_definition_id, type, sequence, status, output_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.workspaceId, input.issueId, input.stageDefinitionId, input.type, input.sequence, input.status, JSON.stringify(input.outputArtifacts ?? {}), input.enteredAt ?? null);
    return this.getStage(input.id)!;
  }

  getStage(id: string): Stage | undefined {
    const row = this.db.prepare("SELECT * FROM stage WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapStage(row) : undefined;
  }

  listStages(workspaceId: string): Stage[] {
    const rows = this.db.prepare("SELECT * FROM stage WHERE workspace_id = ? ORDER BY sequence ASC").all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapStage);
  }

  listStagesByIssue(issueId: string): Stage[] {
    const rows = this.db.prepare("SELECT * FROM stage WHERE issue_id = ? ORDER BY sequence ASC").all(issueId) as Record<string, unknown>[];
    return rows.map(mapStage);
  }

  getActiveStage(issueId: string): Stage | undefined {
    const row = this.db
      .prepare("SELECT * FROM stage WHERE issue_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1")
      .get(issueId) as Record<string, unknown> | undefined;
    return row ? mapStage(row) : undefined;
  }

  updateStage(id: string, updates: Partial<Pick<Stage, "status" | "output_artifacts" | "gate_evidence" | "entered_at" | "left_at">>): Stage {
    const stage = this.getStage(id);
    if (!stage) throw new Error(`Stage not found: ${id}`);
    this.db.prepare(
      "UPDATE stage SET status = ?, output_artifacts = ?, gate_evidence = ?, entered_at = ?, left_at = ? WHERE id = ?"
    ).run(
      updates.status ?? stage.status,
      JSON.stringify(updates.output_artifacts ?? stage.output_artifacts),
      updates.gate_evidence !== undefined
        ? JSON.stringify(updates.gate_evidence)
        : stage.gate_evidence
          ? JSON.stringify(stage.gate_evidence)
          : null,
      updates.entered_at ?? stage.entered_at,
      updates.left_at ?? stage.left_at,
      id
    );
    return this.getStage(id)!;
  }
  createConversation(input: CreateConversationInput): Conversation {
    this.db.prepare(
      "INSERT INTO conversation (id, workspace_id, issue_id, stage_id, owner_type, owner_id, title, kind, status, default_role, participating_roles, summary, from_conversation_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)"
    ).run(
      input.id,
      input.workspaceId,
      input.issueId,
      input.stageId,
      input.ownerType ?? "workspace_stage",
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

  listConversationsByWorkspace(workspaceId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapConversation);
  }

  listConversationsByIssue(issueId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE issue_id = ? ORDER BY updated_at DESC").all(issueId) as Record<string, unknown>[];
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
  addMessage(input: CreateMessageInput): Message {
    const insert = this.db.prepare(
      "INSERT INTO message (conversation_id, client_id, from_role, to_roles, role, quoted_message_id, context_cutoff_at, runtime, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const updateConversation = this.db.prepare("UPDATE conversation SET updated_at = datetime('now') WHERE id = ?");
    const updateIssue = this.db.prepare("UPDATE issue SET updated_at = datetime('now') WHERE id = (SELECT issue_id FROM conversation WHERE id = ? AND issue_id IS NOT NULL)");

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
      updateIssue.run(payload.conversationId);
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
  getMessagesBefore(conversationId: string, beforeMessageId: number, limit = 20): MessageWithEvents[] {
    const normalizedLimit = Math.max(1, Math.min(limit, 50));
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM message
        WHERE conversation_id = ? AND id < ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      ) ORDER BY datetime(created_at) ASC, id ASC
    `).all(conversationId, beforeMessageId, normalizedLimit) as Record<string, unknown>[];
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
    markWorkspaceDispatchesConsumed(this.db, dispatchIds, consumedByMessageId);
  }
  markConversationDispatchesConsumed(conversationId: string, dispatchIds: number[], consumedByMessageId: number | null = null): void {
    this.markDispatchesConsumed(dispatchIds, consumedByMessageId);
  }
  markDispatchesSeen(dispatchIds: number[]): void {
    markWorkspaceDispatchesSeen(this.db, dispatchIds);
  }
  markConversationDispatchesSeen(conversationId: string, dispatchIds: number[]): void {
    this.markDispatchesSeen(dispatchIds);
  }
  skipDispatches(dispatchIds: number[]): void {
    skipWorkspaceDispatches(this.db, dispatchIds);
  }
  skipConversationDispatches(conversationId: string, dispatchIds: number[]): void {
    this.skipDispatches(dispatchIds);
  }
  listBossPendingDispatches(conversationId: string): MessageDispatch[] {
    return listWorkspaceBossPendingDispatches(this.db, conversationId);
  }
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
  updateSnailAgentSessionExternalId(sessionId: string, externalSessionId: string | null): void { this.db.prepare("UPDATE snail_agent_session SET external_session_id = ? WHERE id = ?").run(externalSessionId, sessionId); }
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
  rebuildFeatureChainIndex(): void { rebuildFeatureChainIndex(this.db); }
  getDb(): Database.Database { return this.db; }
  close(): void { this.db.close(); }
}
