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
export type MessageType = "text" | "tool_use" | "tool_result" | "system_event";
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
  snail_name: SnailName;
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
  message_type: MessageType;
  content: string;
  metadata: string | null;
  created_at: string;
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
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS stages (
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
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        snail_name TEXT NOT NULL,
        participating_snails TEXT NOT NULL DEFAULT '[]',
        summary TEXT,
        from_conversation_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifacts (
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
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_stages_project_sequence ON stages(project_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_conversations_project_stage ON conversations(project_id, stage_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_artifacts_project_stage ON artifacts(project_id, stage_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id);
    `);
  }

  createProject(id: string, kind: ProjectKind, name: string, summary?: string): Project {
    this.db.prepare("INSERT INTO projects (id, kind, name, summary, status) VALUES (?, ?, ?, ?, 'active')").run(id, kind, name, summary ?? null);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | undefined {
    return this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  }

  listProjects(limit = 50, offset = 0): Project[] {
    return this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Project[];
  }

  createStage(id: string, projectId: string, type: StageType, sequence: number, status: StageStatus, formalArtifacts?: string[], enteredAt?: string | null): Stage {
    this.db.prepare(
      "INSERT INTO stages (id, project_id, type, sequence, status, formal_artifacts, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, projectId, type, sequence, status, JSON.stringify(formalArtifacts ?? []), enteredAt ?? null);
    return this.getStage(id)!;
  }

  getStage(id: string): Stage | undefined {
    const row = this.db.prepare("SELECT * FROM stages WHERE id = ?").get(id) as any;
    return row ? mapStage(row) : undefined;
  }

  listStages(projectId: string): Stage[] {
    const rows = this.db.prepare("SELECT * FROM stages WHERE project_id = ? ORDER BY sequence ASC").all(projectId) as any[];
    return rows.map(mapStage);
  }

  getActiveStage(projectId: string): Stage | undefined {
    const row = this.db
      .prepare("SELECT * FROM stages WHERE project_id = ? AND status = 'in_progress' ORDER BY sequence DESC LIMIT 1")
      .get(projectId) as any;
    return row ? mapStage(row) : undefined;
  }

  updateStage(id: string, updates: Partial<Pick<Stage, "status" | "formal_artifacts" | "entered_at" | "left_at">>): Stage {
    const stage = this.getStage(id);
    if (!stage) {
      throw new Error(`Stage not found: ${id}`);
    }
    this.db.prepare(
      "UPDATE stages SET status = ?, formal_artifacts = ?, entered_at = ?, left_at = ?, updated_at = datetime('now') WHERE id = ?"
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
    snailName: SnailName,
    participatingSnails: SnailName[],
    summary?: string,
    fromConversationIds?: string[]
  ): Conversation {
    this.db.prepare(
      "INSERT INTO conversations (id, project_id, stage_id, title, kind, status, snail_name, participating_snails, summary, from_conversation_ids) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)"
    ).run(id, projectId, stageId, title, kind, snailName, JSON.stringify(participatingSnails), summary ?? null, JSON.stringify(fromConversationIds ?? []));
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as any;
    return row ? mapConversation(row) : undefined;
  }

  listConversationsByProject(projectId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as any[];
    return rows.map(mapConversation);
  }

  listConversationsByStage(stageId: string): Conversation[] {
    const rows = this.db.prepare("SELECT * FROM conversations WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId) as any[];
    return rows.map(mapConversation);
  }

  updateConversation(id: string, updates: Partial<Pick<Conversation, "status" | "summary" | "from_conversation_ids" | "participating_snails" | "title">>): Conversation {
    const conversation = this.getConversation(id);
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`);
    }
    this.db.prepare(
      "UPDATE conversations SET title = ?, status = ?, participating_snails = ?, summary = ?, from_conversation_ids = ?, updated_at = datetime('now') WHERE id = ?"
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

  addMessage(conversationId: string, role: MessageRole, content: string, messageType: MessageType = "text", metadata?: string): Message {
    const insert = this.db.prepare(
      "INSERT INTO messages (conversation_id, role, message_type, content, metadata) VALUES (?, ?, ?, ?, ?)"
    );
    const updateConversation = this.db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?");
    const updateProject = this.db.prepare(
      "UPDATE projects SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM conversations WHERE id = ?)"
    );

    const transaction = this.db.transaction((cid: string, r: MessageRole, mt: MessageType, c: string, m?: string) => {
      insert.run(cid, r, mt, c, m ?? null);
      updateConversation.run(cid);
      updateProject.run(cid);
    });

    transaction(conversationId, role, messageType, content, metadata);
    const { id } = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Message;
  }

  updateMessage(id: number, content: string): void {
    this.db.prepare("UPDATE messages SET content = ?, created_at = datetime('now') WHERE id = ?").run(content, id);
  }

  getMessages(conversationId: string, limit = 100, offset = 0): Message[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(conversationId, limit, offset) as Message[];
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
      "INSERT INTO artifacts (id, project_id, stage_id, conversation_id, artifact_type, title, status, storage_type, file_path, inline_content, external_ref, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
    return this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Artifact | undefined;
  }

  listArtifactsByStage(stageId: string): Artifact[] {
    return this.db.prepare("SELECT * FROM artifacts WHERE stage_id = ? ORDER BY updated_at DESC").all(stageId) as Artifact[];
  }

  listArtifactsByConversation(conversationId: string): Artifact[] {
    return this.db.prepare("SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY updated_at DESC").all(conversationId) as Artifact[];
  }

  updateArtifact(id: string, updates: Partial<Omit<Artifact, "id" | "project_id" | "stage_id" | "conversation_id" | "created_at">>): Artifact {
    const artifact = this.getArtifact(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }
    this.db.prepare(
      "UPDATE artifacts SET artifact_type = ?, title = ?, status = ?, storage_type = ?, file_path = ?, inline_content = ?, external_ref = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?"
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
