import Database from "better-sqlite3";
import path from "path";
import { loadStageDefinitions } from "../meta";

export type ProjectKind = "system_self" | "product_delivery";
export type ProjectStatus = "active" | "paused" | "completed" | "cancelled" | "archived";
export type StageType =
  | "init"
  | "discuss"
  | "coding"
  | "check"
  | "publish";
export type StageStatus = "in_progress" | "completed" | "cancelled";
export type ConversationKind = "discussion" | "planning" | "design" | "implementation" | "review" | "bugfix";
export type ConversationStatus = "active" | "paused" | "completed" | "archived";
export type SnailName = "owner" | "product_agent" | "design_agent" | "implementation_agent" | "acceptance_agent";
export type MessageRole = "user" | "assistant" | "system";
export type MessagePartType = "text" | "tool_use" | "result" | "system_event";
export type ArtifactStatus = "draft" | "active" | "approved" | "superseded" | "archived";
export type ArtifactStorageType = "markdown_file" | "inline_text" | "json_record" | "external_ref";
export type ArtifactType =
  | "project_charter"
  | "initiative_discussion_record"
  | "requirement_document"
  | "product_specification"
  | "technical_design"
  | "implementation_task_breakdown"
  | "acceptance_report"
  | "code_commit"
  | "code_change_record"
  | "evolution_record"
  | "bug_analysis";

export const STAGE_DEFINITIONS = loadStageDefinitions();
export const STAGE_TYPES = Object.keys(STAGE_DEFINITIONS) as StageType[];
export const STAGE_FORMAL_ARTIFACT_TYPES: Record<StageType, ArtifactType[]> = Object.fromEntries(
  Object.entries(STAGE_DEFINITIONS).map(([type, config]) => [type, config.formal_artifact_types])
) as Record<StageType, ArtifactType[]>;

export interface Project {
  id: string;
  kind: ProjectKind;
  name: string;
  summary: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  project_id: string;
  type: StageType;
  sequence: number;
  status: StageStatus;
  formal_artifacts: string[];
  created_at: string;
  updated_at: string;
  entered_at: string | null;
  left_at: string | null;
}

export interface Conversation {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  kind: ConversationKind;
  status: ConversationStatus;
  default_snail: string;
  participating_snails: SnailName[];
  summary: string | null;
  from_conversation_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: MessageRole;
  snail_name: string | null;
  created_at: string;
}

export interface MessagePart {
  id: number;
  message_id: number;
  sequence: number;
  part_type: MessagePartType;
  content: string;
  created_at: string;
}

export interface MessageWithParts extends Message {
  parts: MessagePart[];
}

export interface ConversationHistorySearchResult {
  message_id: number;
  role: MessageRole;
  snail_name: string | null;
  created_at: string;
  snippet: string;
}

export interface Artifact {
  id: string;
  project_id: string;
  stage_id: string;
  conversation_id: string;
  artifact_type: ArtifactType;
  title: string;
  status: ArtifactStatus;
  storage_type: ArtifactStorageType;
  file_path: string | null;
  inline_content: string | null;
  external_ref: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray<T extends string>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapStage(row: any): Stage {
  return {
    ...row,
    formal_artifacts: parseJsonArray<string>(row.formal_artifacts),
  };
}

function mapConversation(row: any): Conversation {
  return {
    ...row,
    participating_snails: parseJsonArray<string>(row.participating_snails),
    from_conversation_ids: parseJsonArray<string>(row.from_conversation_ids),
  };
}

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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS stage (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        formal_artifacts TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        entered_at TEXT,
        left_at TEXT,
        FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
        UNIQUE(project_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS conversation (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        default_snail TEXT NOT NULL,
        participating_snails TEXT NOT NULL DEFAULT '[]',
        summary TEXT,
        from_conversation_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
        FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        snail_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS message_part (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        part_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifact (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        storage_type TEXT NOT NULL,
        file_path TEXT,
        inline_content TEXT,
        external_ref TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
        FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
        conversation_id UNINDEXED,
        message_id UNINDEXED,
        role UNINDEXED,
        snail_name UNINDEXED,
        content
      );

      CREATE INDEX IF NOT EXISTS idx_stage_project_sequence ON stage(project_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id);
      CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON message(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_message_part_message_sequence ON message_part(message_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_artifact_project_stage ON artifact(project_id, stage_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_conversation ON artifact(conversation_id);
    `);

  }

  createProject(id: string, kind: ProjectKind, name: string, summary?: string): Project {
    this.db.prepare("INSERT INTO project (id, kind, name, summary, status) VALUES (?, ?, ?, ?, 'active')").run(id, kind, name, summary ?? null);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | undefined {
    return this.db.prepare("SELECT * FROM project WHERE id = ?").get(id) as Project | undefined;
  }

  listProjects(limit = 50, offset = 0): Project[] {
    return this.db.prepare("SELECT * FROM project ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Project[];
  }

  createStage(id: string, projectId: string, type: StageType, sequence: number, status: StageStatus, formalArtifacts?: string[], enteredAt?: string | null): Stage {
    this.db.prepare(
      "INSERT INTO stage (id, project_id, type, sequence, status, formal_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, projectId, type, sequence, status, JSON.stringify(formalArtifacts ?? []), enteredAt ?? null);
    return this.getStage(id)!;
  }

  getStage(id: string): Stage | undefined {
    const row = this.db.prepare("SELECT * FROM stage WHERE id = ?").get(id) as any;
    return row ? mapStage(row) : undefined;
  }

  listStages(projectId: string): Stage[] {
    const rows = this.db.prepare("SELECT * FROM stage WHERE project_id = ? ORDER BY sequence ASC").all(projectId) as any[];
    return rows.map(mapStage);
  }

  getActiveStage(projectId: string): Stage | undefined {
    const row = this.db
      .prepare("SELECT * FROM stage WHERE project_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1")
      .get(projectId) as any;
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

  createConversation(
    id: string,
    projectId: string,
    stageId: string,
    title: string,
    kind: ConversationKind,
    defaultSnail: string,
    participatingSnails: SnailName[],
    summary?: string,
    fromConversationIds?: string[]
  ): Conversation {
    this.db.prepare(
      "INSERT INTO conversation (id, project_id, stage_id, title, kind, status, default_snail, participating_snails, summary, from_conversation_ids) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)"
    ).run(id, projectId, stageId, title, kind, defaultSnail, JSON.stringify(participatingSnails), summary ?? null, JSON.stringify(fromConversationIds ?? []));
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversation WHERE id = ?").get(id) as any;
    return row ? mapConversation(row) : undefined;
  }

  listConversationsByProject(projectId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as any[];
    return rows.map(mapConversation);
  }

  listConversationsByStage(stageId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversation WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId) as any[];
    return rows.map(mapConversation);
  }

  updateConversation(id: string, updates: Partial<Pick<Conversation, "status" | "summary" | "from_conversation_ids" | "participating_snails" | "title">>): Conversation {
    const conversation = this.getConversation(id);
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`);
    }
    this.db.prepare(
      "UPDATE conversation SET title = ?, status = ?, participating_snails = ?, summary = ?, from_conversation_ids = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(
      updates.title ?? conversation.title,
      updates.status ?? conversation.status,
      JSON.stringify(updates.participating_snails ?? conversation.participating_snails),
      updates.summary ?? conversation.summary,
      JSON.stringify(updates.from_conversation_ids ?? conversation.from_conversation_ids),
      id
    );
    return this.getConversation(id)!;
  }

  addMessage(conversationId: string, role: MessageRole, snailName: string | null = null): Message {
    const insert = this.db.prepare("INSERT INTO message (conversation_id, role, snail_name) VALUES (?, ?, ?)");
    const updateConversation = this.db.prepare("UPDATE conversation SET updated_at = datetime('now') WHERE id = ?");
    const updateProject = this.db.prepare(
      "UPDATE project SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM conversation WHERE id = ?)"
    );

    const transaction = this.db.transaction((cid: string, r: MessageRole, speaker: string | null) => {
      insert.run(cid, r, speaker);
      updateConversation.run(cid);
      updateProject.run(cid);
    });

    transaction(conversationId, role, snailName);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.db.prepare("SELECT * FROM message WHERE id = ?").get(id) as Message;
  }

  addMessagePart(messageId: number, sequence: number, partType: MessagePartType, content: string): MessagePart {
    this.db
      .prepare("INSERT INTO message_part (message_id, sequence, part_type, content) VALUES (?, ?, ?, ?)")
      .run(messageId, sequence, partType, content);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.db.prepare("SELECT * FROM message_part WHERE id = ?").get(id) as MessagePart;
  }

  replaceMessageParts(messageId: number, parts: Array<{ part_type: MessagePartType; content: string }>): void {
    const deleteParts = this.db.prepare("DELETE FROM message_part WHERE message_id = ?");
    const insertPart = this.db.prepare("INSERT INTO message_part (message_id, sequence, part_type, content) VALUES (?, ?, ?, ?)");
    const transaction = this.db.transaction((mid: number, incoming: Array<{ part_type: MessagePartType; content: string }>) => {
      deleteParts.run(mid);
      incoming.forEach((part, index) => {
        insertPart.run(mid, index + 1, part.part_type, part.content);
      });
      this.reindexMessage(mid);
    });
    transaction(messageId, parts);
  }

  getMessageParts(messageId: number): MessagePart[] {
    return this.db.prepare("SELECT * FROM message_part WHERE message_id = ? ORDER BY sequence ASC").all(messageId) as MessagePart[];
  }

  getMessages(conversationId: string, limit = 100, offset = 0): MessageWithParts[] {
    const messages = this.db
      .prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(conversationId, limit, offset) as Message[];
    return messages.map((message) => ({
      ...message,
      parts: this.getMessageParts(message.id),
    }));
  }

  getRecentMessages(conversationId: string, limit = 5): MessageWithParts[] {
    const messages = this.db
      .prepare("SELECT * FROM message WHERE conversation_id = ? ORDER BY id DESC LIMIT ?")
      .all(conversationId, limit) as Message[];
    return messages
      .reverse()
      .map((message) => ({
        ...message,
        parts: this.getMessageParts(message.id),
      }));
  }

  getRecentConversationTurns(conversationId: string, userTurnCount = 3): MessageWithParts[] {
    const normalizedTurnCount = Math.max(1, userTurnCount);
    const anchorRow = this.db
      .prepare(
        `SELECT id FROM message
         WHERE conversation_id = ? AND role = 'user'
         ORDER BY id DESC
         LIMIT 1 OFFSET ?`
      )
      .get(conversationId, normalizedTurnCount - 1) as { id: number } | undefined;

    if (!anchorRow) {
      return this.getMessages(conversationId);
    }

    const messages = this.db
      .prepare("SELECT * FROM message WHERE conversation_id = ? AND id >= ? ORDER BY id ASC")
      .all(conversationId, anchorRow.id) as Message[];
    return messages.map((message) => ({
      ...message,
      parts: this.getMessageParts(message.id),
    }));
  }

  getMessagesByIds(conversationId: string, messageIds: number[]): MessageWithParts[] {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => "?").join(", ");
    const messages = this.db
      .prepare(`SELECT * FROM message WHERE conversation_id = ? AND id IN (${placeholders}) ORDER BY id ASC`)
      .all(conversationId, ...messageIds) as Message[];
    return messages.map((message) => ({
      ...message,
      parts: this.getMessageParts(message.id),
    }));
  }

  getMessageWindow(conversationId: string, anchorMessageId: number, before = 2, after = 2): MessageWithParts[] {
    const messages = this.db
      .prepare(
        "SELECT * FROM message WHERE conversation_id = ? AND id BETWEEN ? AND ? ORDER BY id ASC"
      )
      .all(conversationId, anchorMessageId - before, anchorMessageId + after) as Message[];
    return messages.map((message) => ({
      ...message,
      parts: this.getMessageParts(message.id),
    }));
  }

  searchConversationMessages(conversationId: string, query: string, limit = 5, offset = 0): ConversationHistorySearchResult[] {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const rows = this.db
      .prepare(
        `SELECT
           message.id as message_id,
           message.role as role,
           message.snail_name as snail_name,
           message.created_at as created_at,
           snippet(message_search, 4, '', '', '...', 18) as snippet
         FROM message_search
         JOIN message ON message.id = CAST(message_search.message_id AS INTEGER)
         WHERE message_search.conversation_id = ?
           AND message_search MATCH ?
         ORDER BY bm25(message_search), message.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(conversationId, buildFtsQuery(trimmedQuery), limit, offset) as Array<{
        message_id: number;
        role: MessageRole;
        snail_name: string | null;
        created_at: string;
        snippet: string;
      }>;

    return rows.map((row) => ({
      message_id: row.message_id,
      role: row.role,
      snail_name: row.snail_name,
      created_at: row.created_at,
      snippet: normalizeSnippet(row.snippet),
    }));
  }

  rebuildSearchIndex(conversationId?: string): { indexed_messages: number } {
    const targetMessages = conversationId
      ? this.db.prepare("SELECT id FROM message WHERE conversation_id = ? ORDER BY id ASC").all(conversationId) as Array<{ id: number }>
      : this.db.prepare("SELECT id FROM message ORDER BY id ASC").all() as Array<{ id: number }>;

    if (conversationId) {
      this.db.prepare("DELETE FROM message_search WHERE conversation_id = ?").run(conversationId);
    } else {
      this.db.prepare("DELETE FROM message_search").run();
    }

    targetMessages.forEach((message) => this.reindexMessage(message.id));
    return { indexed_messages: targetMessages.length };
  }

  private reindexMessage(messageId: number): void {
    const message = this.db.prepare("SELECT * FROM message WHERE id = ?").get(messageId) as Message | undefined;
    if (!message) return;

    this.db.prepare("DELETE FROM message_search WHERE message_id = ?").run(String(messageId));

    const content = this.buildSearchableMessageContent(messageId, message.role);
    if (!content) return;

    this.db.prepare(
      "INSERT INTO message_search (conversation_id, message_id, role, snail_name, content) VALUES (?, ?, ?, ?, ?)"
    ).run(message.conversation_id, String(message.id), message.role, message.snail_name, content);
  }

  private buildSearchableMessageContent(messageId: number, role: MessageRole): string {
    const parts = this.getMessageParts(messageId);
    if (role === "user") {
      return parts
        .filter((part) => part.part_type === "text")
        .map((part) => part.content)
        .join("\n\n")
        .trim();
    }

    if (role === "assistant") {
      const result = parts
        .filter((part) => part.part_type === "result")
        .map((part) => part.content)
        .join("\n\n")
        .trim();
      if (result) {
        return result;
      }
    }

    return "";
  }

  createArtifact(
    id: string,
    projectId: string,
    stageId: string,
    conversationId: string,
    artifactType: ArtifactType,
    title: string,
    status: ArtifactStatus,
    storageType: ArtifactStorageType,
    options?: { filePath?: string; inlineContent?: string; externalRef?: string; metadata?: string }
  ): Artifact {
    this.db.prepare(
      "INSERT INTO artifact (id, project_id, stage_id, conversation_id, artifact_type, title, status, storage_type, file_path, inline_content, external_ref, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      projectId,
      stageId,
      conversationId,
      artifactType,
      title,
      status,
      storageType,
      options?.filePath ?? null,
      options?.inlineContent ?? null,
      options?.externalRef ?? null,
      options?.metadata ?? null
    );
    return this.getArtifact(id)!;
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

function buildFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/"/g, '""').trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return '""';
  }

  return tokens.map((token) => `"${token}"`).join(" AND ");
}

function normalizeSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, " ").trim();
}
