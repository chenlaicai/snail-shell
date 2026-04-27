/* eslint-disable max-lines */
import Database from "better-sqlite3";
import path from "path";
import { loadStageDefinitions } from "../meta";
import { attachMessageParts, buildFtsQuery, buildSearchableMessageContent, mapConversation, mapMessage, mapMessagePart, mapStage, normalizeSnippet, serializeMessagePartPayload } from "./helpers";
import { SCHEMA_SQL } from "./schema";
export type {
  Artifact,
  ArtifactContentOptions,
  ArtifactStatus,
  ArtifactStorageType,
  ArtifactType,
  BlocksResultPayload,
  Conversation,
  ConversationHistorySearchResult,
  ConversationKind,
  ConversationStatus,
  CreateArtifactInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  CreateMessageInput,
  MessagePartInput,
  CreateStageInput,
  DispatchInboxGroup,
  DispatchInboxPreviewItem,
  Message,
  MessageDispatch,
  CreateMessagePartInput,
  MessagePart,
  StartMessagePart,
  DeltaMessagePart,
  ResultMessagePart,
  EndMessagePart,
  PersistedMessagePartRow,
  MessageRole,
  MessageWithParts,
  MessagePartPayload,
  StartPartPayload,
  DeltaPartPayload,
  ResultPartPayload,
  EndPartPayload,
  MessageContentBlock,
  Project,
  ProjectKind,
  ProjectStatus,
  SnailName,
  Stage,
  StageStatus,
  StageType,
} from "./types";
export { MessagePartKind } from "./types";
import type {
  Artifact,
  ArtifactType,
  Conversation,
  ConversationHistorySearchResult,
  CreateArtifactInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  CreateMessageInput,
  CreateStageInput,
  DispatchInboxGroup,
  Message,
  MessageDispatch,
  CreateMessagePartInput,
  MessagePart,
  PersistedMessagePartRow,
  MessageRole,
  MessageWithParts,
  Project,
  ProjectKind,
  SnailName,
  Stage,
  StageType,
} from "./types";

export const STAGE_DEFINITIONS = loadStageDefinitions();
export const STAGE_TYPES = Object.keys(STAGE_DEFINITIONS) as StageType[];
export const STAGE_FORMAL_ARTIFACT_TYPES: Record<StageType, ArtifactType[]> = Object.fromEntries(
  Object.entries(STAGE_DEFINITIONS).map(([type, config]) => [type, config.formal_artifact_types])
) as Record<StageType, ArtifactType[]>;

export class ConversationStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "snail-shell.db");
    const dir = path.dirname(resolvedPath);
    const fs = require("fs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(SCHEMA_SQL);
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

  createStage(input: CreateStageInput): Stage {
    this.db.prepare(
      "INSERT INTO stage (id, project_id, type, sequence, status, formal_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(input.id, input.projectId, input.type, input.sequence, input.status, JSON.stringify(input.formalArtifacts ?? []), input.enteredAt ?? null);
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

  getActiveStage(projectId: string): Stage | undefined {
    const row = this.db
      .prepare("SELECT * FROM stage WHERE project_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1")
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? mapStage(row) : undefined;
  }

  updateStage(id: string, updates: Partial<Pick<Stage, "status" | "formal_artifacts" | "entered_at" | "left_at">>): Stage {
    const stage = this.getStage(id);
    if (!stage) {
      throw new Error(`Stage not found: ${id}`);
    }
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
      "INSERT INTO conversation (id, project_id, stage_id, title, kind, status, default_snail, participating_snails, summary, from_conversation_ids, runtime_sessions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)"
    ).run(
      input.id,
      input.projectId,
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
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`);
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

  addMessage(input: CreateMessageInput): Message {
    const insert = this.db.prepare(
      "INSERT INTO message (conversation_id, from_snail, to_snails, role, quoted_message_id, context_cutoff_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const updateConversation = this.db.prepare("UPDATE conversation SET updated_at = datetime('now') WHERE id = ?");
    const updateProject = this.db.prepare(
      "UPDATE project SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM conversation WHERE id = ?)"
    );

    const transaction = this.db.transaction((payload: CreateMessageInput) => {
      insert.run(
        payload.conversationId,
        payload.fromSnail,
        JSON.stringify(payload.toSnails ?? []),
        payload.role,
        payload.quotedMessageId ?? null,
        payload.contextCutoffAt ?? new Date().toISOString()
      );
      updateConversation.run(payload.conversationId);
      updateProject.run(payload.conversationId);
    });

    transaction(input);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.getMessage(id)!;
  }

  addMessagePart(messageId: number, part: CreateMessagePartInput): MessagePart {
    this.db
      .prepare("INSERT INTO message_part (message_id, kind, payload) VALUES (?, ?, ?)")
      .run(
        messageId,
        part.kind,
        serializeMessagePartPayload(part.payload)
      );
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    this.reindexMessage(messageId);
    return mapMessagePart(this.db.prepare("SELECT * FROM message_part WHERE id = ?").get(id) as PersistedMessagePartRow);
  }

  setMessageContent(messageId: number, part: CreateMessagePartInput): void {
    if (part.kind !== "result") {
      throw new Error(`setMessageContent only accepts result parts, received: ${part.kind}`);
    }

    const deleteContent = this.db.prepare("DELETE FROM message_part WHERE message_id = ? AND kind = ?");
    const insertContent = this.db.prepare(
      "INSERT INTO message_part (message_id, kind, payload) VALUES (?, ?, ?)"
    );
    const transaction = this.db.transaction((mid: number, resultPart: CreateMessagePartInput) => {
      deleteContent.run(mid, "result");
      insertContent.run(
        mid,
        resultPart.kind,
        serializeMessagePartPayload(resultPart.payload)
      );
      this.reindexMessage(mid);
    });
    transaction(messageId, part);
    this.rebuildDispatchesForMessage(messageId);
  }

  getMessageParts(messageId: number): MessagePart[] {
    const rows = this.db
      .prepare("SELECT * FROM message_part WHERE message_id = ? ORDER BY datetime(created_at) ASC, id ASC")
      .all(messageId) as PersistedMessagePartRow[];

    return rows.map(mapMessagePart);
  }

  getMessage(messageId: number, conversationId?: string): Message | null {
    const query = conversationId
      ? "SELECT * FROM message WHERE id = ? AND conversation_id = ?"
      : "SELECT * FROM message WHERE id = ?";
    const params = conversationId ? [messageId, conversationId] : [messageId];
    const row = this.db.prepare(query).get(...params) as Record<string, unknown> | undefined;
    return row ? mapMessage(row) : null;
  }

  getMessages(conversationId: string, limit = 100, offset = 0): MessageWithParts[] {
    const rows = this.db
      .prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC LIMIT ? OFFSET ?")
      .all(conversationId, limit, offset) as Record<string, unknown>[];
    return attachMessageParts(rows.map(mapMessage), (messageId) => this.getMessageParts(messageId));
  }

  getRecentMessages(conversationId: string, limit = 5): MessageWithParts[] {
    const rows = this.db
      .prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?")
      .all(conversationId, limit) as Record<string, unknown>[];
    return attachMessageParts(rows.map(mapMessage).reverse(), (messageId) => this.getMessageParts(messageId));
  }

  getRecentConversationMessagesWindow(conversationId: string, userMessageCount = 3): MessageWithParts[] {
    const normalizedMessageCount = Math.max(1, userMessageCount);
    const anchorRow = this.db
      .prepare(
        `SELECT id FROM message
         WHERE conversation_id = ? AND role = 'user'
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT 1 OFFSET ?`
      )
      .get(conversationId, normalizedMessageCount - 1) as { id: number } | undefined;

    if (!anchorRow) {
      return this.getMessages(conversationId);
    }

    const rows = this.db
      .prepare("SELECT * FROM message WHERE conversation_id = ? AND id >= ? ORDER BY datetime(created_at) ASC, id ASC")
      .all(conversationId, anchorRow.id) as Record<string, unknown>[];
    return attachMessageParts(rows.map(mapMessage), (messageId) => this.getMessageParts(messageId));
  }

  getMessagesSinceSnailReply(conversationId: string, snailName: string): MessageWithParts[] {
    const lastSnailReply = this.db
      .prepare(
        `SELECT id FROM message
         WHERE conversation_id = ? AND role = 'assistant' AND from_snail = ?
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT 1`
      )
      .get(conversationId, snailName) as { id: number } | undefined;

    const rows = lastSnailReply
      ? this.db
          .prepare("SELECT * FROM message WHERE conversation_id = ? AND id > ? ORDER BY datetime(created_at) ASC, id ASC")
          .all(conversationId, lastSnailReply.id) as Record<string, unknown>[]
      : this.db
          .prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC")
          .all(conversationId) as Record<string, unknown>[];

    return attachMessageParts(rows.map(mapMessage), (messageId) => this.getMessageParts(messageId));
  }

  getMessagesByIds(conversationId: string, messageIds: number[]): MessageWithParts[] {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT * FROM message WHERE conversation_id = ? AND id IN (${placeholders}) ORDER BY datetime(created_at) ASC, id ASC`)
      .all(conversationId, ...messageIds) as Record<string, unknown>[];
    return attachMessageParts(rows.map(mapMessage), (messageId) => this.getMessageParts(messageId));
  }

  getMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): MessageWithParts[] {
    const anchor = this.db.prepare("SELECT id FROM message WHERE conversation_id = ? AND id = ?").get(conversationId, anchorMessageId) as { id: number } | undefined;
    if (!anchor) return [];
    const rows = this.db
      .prepare("SELECT * FROM message WHERE conversation_id = ? AND id BETWEEN ? AND ? ORDER BY datetime(created_at) ASC, id ASC")
      .all(conversationId, anchorMessageId - before, anchorMessageId + after) as Record<string, unknown>[];
    return attachMessageParts(rows.map(mapMessage), (messageId) => this.getMessageParts(messageId));
  }

  searchConversationMessages(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchResult[] {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const rows = this.db
      .prepare(
        `SELECT
           message.id as message_id,
           message.role as role,
           message.from_snail as from_snail,
           message.created_at as created_at,
           snippet(message_search, 4, '', '', '...', 18) as snippet
         FROM message_search
         JOIN message ON message.id = CAST(message_search.message_id AS INTEGER)
         WHERE message_search.conversation_id = ?
           AND message_search MATCH ?
         ORDER BY bm25(message_search), datetime(message.created_at) DESC, message.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(conversationId, buildFtsQuery(trimmedQuery), limit, offset) as Array<{
        message_id: number;
        role: MessageRole;
        from_snail: SnailName | null;
        created_at: string;
        snippet: string;
      }>;

    return rows.map((row) => ({
      message_id: row.message_id,
      role: row.role,
      from_snail: row.from_snail,
      created_at: row.created_at,
      snippet: normalizeSnippet(row.snippet),
    }));
  }

  addMessageDispatch(input: CreateMessageDispatchInput): MessageDispatch {
    this.db
      .prepare("INSERT INTO message_dispatch (conversation_id, message_id, to_snail) VALUES (?, ?, ?)")
      .run(input.conversationId, input.messageId, input.toSnail);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.db.prepare("SELECT * FROM message_dispatch WHERE id = ?").get(id) as MessageDispatch;
  }

  rebuildDispatchesForMessage(messageId: number): void {
    const message = this.getMessage(messageId);
    if (!message) {
      return;
    }
    this.db.prepare("DELETE FROM message_dispatch WHERE message_id = ?").run(messageId);
    for (const toSnail of message.to_snails) {
      this.addMessageDispatch({
        conversationId: message.conversation_id,
        messageId: message.id,
        toSnail,
      });
    }
  }

  updateMessageRouting(messageId: number, toSnails: SnailName[]): void {
    const message = this.getMessage(messageId);
    if (!message) {
      return;
    }

    this.db.prepare("UPDATE message SET to_snails = ? WHERE id = ?").run(JSON.stringify(toSnails), messageId);
    this.rebuildDispatchesForMessage(messageId);
  }

  listPendingDispatches(conversationId: string, toSnail?: SnailName): MessageDispatch[] {
    if (toSnail) {
      return this.db
        .prepare(
          "SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_snail = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC"
        )
        .all(conversationId, toSnail) as MessageDispatch[];
    }

    return this.db
      .prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC")
      .all(conversationId) as MessageDispatch[];
  }

  listDispatches(conversationId: string): MessageDispatch[] {
    return this.db
      .prepare("SELECT * FROM message_dispatch WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC")
      .all(conversationId) as MessageDispatch[];
  }

  listDispatchInboxGroups(conversationId: string): DispatchInboxGroup[] {
    const rows = this.db
      .prepare(
        `SELECT
           to_snail,
           status,
           GROUP_CONCAT(id) as dispatch_ids,
           GROUP_CONCAT(message_id) as message_ids,
           MAX(created_at) as latest_dispatch_at
         FROM message_dispatch
         WHERE conversation_id = ?
         GROUP BY to_snail, status
         ORDER BY datetime(latest_dispatch_at) ASC, to_snail ASC`
      )
      .all(conversationId) as Array<{
        to_snail: SnailName;
        status: "pending" | "seen" | "consumed" | "skipped";
        dispatch_ids: string;
        message_ids: string;
        latest_dispatch_at: string;
      }>;

    return rows.map((row) => ({
      to_snail: row.to_snail,
      status: row.status,
      dispatch_ids: row.dispatch_ids.split(",").map((value) => Number(value)).filter((value) => Number.isInteger(value)),
      message_ids: row.message_ids.split(",").map((value) => Number(value)).filter((value) => Number.isInteger(value)),
      latest_dispatch_at: row.latest_dispatch_at,
    }));
  }

  markDispatchesConsumed(dispatchIds: number[], consumedByMessageId: number | null = null): void {
    if (dispatchIds.length === 0) return;
    const placeholders = dispatchIds.map(() => "?").join(", ");
    this.db
      .prepare(
        `UPDATE message_dispatch
         SET status = 'consumed', consumed_by_message_id = ?, consumed_at = datetime('now')
         WHERE id IN (${placeholders})`
      )
      .run(consumedByMessageId, ...dispatchIds);
  }

  markDispatchesSeen(dispatchIds: number[]): void {
    if (dispatchIds.length === 0) return;
    const placeholders = dispatchIds.map(() => "?").join(", ");
    this.db
      .prepare(
        `UPDATE message_dispatch
         SET status = 'seen', consumed_at = datetime('now')
         WHERE id IN (${placeholders})`
      )
      .run(...dispatchIds);
  }

  skipDispatches(dispatchIds: number[]): void {
    if (dispatchIds.length === 0) return;
    const placeholders = dispatchIds.map(() => "?").join(", ");
    this.db
      .prepare(
        `UPDATE message_dispatch
         SET status = 'skipped', consumed_at = datetime('now')
         WHERE id IN (${placeholders})`
      )
      .run(...dispatchIds);
  }

  listBossPendingDispatches(conversationId: string): MessageDispatch[] {
    return this.db
      .prepare(
        "SELECT * FROM message_dispatch WHERE conversation_id = ? AND to_snail = 'Boss Snail' AND status = 'pending' ORDER BY datetime(created_at) ASC, id ASC"
      )
      .all(conversationId) as MessageDispatch[];
  }

  rebuildSearchIndex(conversationId?: string): { indexed_messages: number } {
    const targetMessages = conversationId
      ? (this.db.prepare("SELECT id FROM message WHERE conversation_id = ? ORDER BY datetime(created_at) ASC, id ASC").all(conversationId) as Array<{ id: number }>)
      : (this.db.prepare("SELECT id FROM message ORDER BY datetime(created_at) ASC, id ASC").all() as Array<{ id: number }>);

    if (conversationId) {
      this.db.prepare("DELETE FROM message_search WHERE conversation_id = ?").run(conversationId);
    } else {
      this.db.prepare("DELETE FROM message_search").run();
    }

    targetMessages.forEach((message) => this.reindexMessage(message.id));
    return { indexed_messages: targetMessages.length };
  }

  private reindexMessage(messageId: number): void {
    const message = this.getMessage(messageId);
    if (!message) return;

    this.db.prepare("DELETE FROM message_search WHERE message_id = ?").run(String(messageId));

    const content = buildSearchableMessageContent(message.role, this.getMessageParts(messageId));
    if (!content) return;

    this.db.prepare(
      "INSERT INTO message_search (conversation_id, message_id, role, from_snail, content) VALUES (?, ?, ?, ?, ?)"
    ).run(message.conversation_id, String(message.id), message.role, message.from_snail, content);
  }

  createArtifact(input: CreateArtifactInput): Artifact {
    this.db.prepare(
      "INSERT INTO artifact (id, project_id, stage_id, conversation_id, artifact_type, title, status, storage_type, file_path, inline_content, external_ref, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      input.id,
      input.projectId,
      input.stageId,
      input.conversationId,
      input.artifactType,
      input.title,
      input.status,
      input.storageType,
      input.options?.filePath ?? null,
      input.options?.inlineContent ?? null,
      input.options?.externalRef ?? null,
      input.options?.metadata ?? null
    );
    return this.getArtifact(input.id)!;
  }

  getArtifact(id: string): Artifact | undefined {
    return this.db.prepare("SELECT * FROM artifact WHERE id = ?").get(id) as Artifact | undefined;
  }

  listArtifactsByStage(stageId: string): Artifact[] {
    return this.db.prepare("SELECT * FROM artifact WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId) as Artifact[];
  }

  listArtifactsByConversation(conversationId: string): Artifact[] {
    return this.db.prepare("SELECT * FROM artifact WHERE conversation_id = ? ORDER BY updated_at DESC").all(conversationId) as Artifact[];
  }

  updateArtifact(id: string, updates: Partial<Omit<Artifact, "id" | "project_id" | "stage_id" | "conversation_id" | "created_at">>): Artifact {
    const artifact = this.getArtifact(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }
    this.db.prepare(
      "UPDATE artifact SET artifact_type = ?, title = ?, status = ?, storage_type = ?, file_path = ?, inline_content = ?, external_ref = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.artifact_type ?? artifact.artifact_type,
      updates.title ?? artifact.title,
      updates.status ?? artifact.status,
      updates.storage_type ?? artifact.storage_type,
      updates.file_path ?? artifact.file_path,
      updates.inline_content ?? artifact.inline_content,
      updates.external_ref ?? artifact.external_ref,
      updates.metadata ?? artifact.metadata,
      id
    );
    return this.getArtifact(id)!;
  }

  close(): void {
    this.db.close();
  }
}
