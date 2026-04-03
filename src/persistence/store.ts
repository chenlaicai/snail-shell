import Database from "better-sqlite3";
import path from "path";

export interface Session {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  type?: string; // "text" | "permission_request"
  metadata?: string; // JSON string for additional data
}

export interface Requirement {
  id: number;
  session_id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
  commit_hash?: string;
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
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        type TEXT DEFAULT 'text',
        metadata TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

      CREATE TABLE IF NOT EXISTS requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        commit_hash TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_requirements_session_id ON requirements(session_id);
      CREATE INDEX IF NOT EXISTS idx_requirements_status ON requirements(status);
    `);

    // Migrate existing messages table to add type and metadata columns if they don't exist
    this.migrateMessagesTable();
  }

  private migrateMessagesTable(): void {
    // Check if type column exists
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as any[];
    const hasTypeColumn = columns.some(col => col.name === "type");
    const hasMetadataColumn = columns.some(col => col.name === "metadata");

    if (!hasTypeColumn) {
      this.db.exec("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'");
    }

    if (!hasMetadataColumn) {
      this.db.exec("ALTER TABLE messages ADD COLUMN metadata TEXT");
    }
  }

  createSession(id: string, title?: string): Session {
    const stmt = this.db.prepare(
      "INSERT INTO sessions (id, title) VALUES (?, ?)"
    );
    stmt.run(id, title ?? null);
    return this.getSession(id)!;
  }

  getSession(id: string): Session | undefined {
    return this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as Session | undefined;
  }

  listSessions(limit = 50, offset = 0): Session[] {
    return this.db
      .prepare(
        "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset) as Session[];
  }

  addMessage(sessionId: string, role: string, content: string, type: string = "text", metadata?: string): Message {
    const insert = this.db.prepare(
      "INSERT INTO messages (session_id, role, content, type, metadata) VALUES (?, ?, ?, ?, ?)"
    );
    const updateSession = this.db.prepare(
      "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?"
    );

    const transaction = this.db.transaction(
      (sid: string, r: string, c: string, t: string, m?: string) => {
        const result = insert.run(sid, r, c, t, m ?? null);
        updateSession.run(sid);
        return result;
      }
    );

    transaction(sessionId, role, content, type, metadata);

    const { id } = this.db
      .prepare("SELECT last_insert_rowid() as id")
      .get() as { id: number };
    return this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as Message;
  }

  updateMessage(id: number, content: string): void {
    const stmt = this.db.prepare(
      "UPDATE messages SET content = ?, created_at = datetime('now') WHERE id = ?"
    );
    stmt.run(content, id);
  }

  getMessages(sessionId: string, limit = 100, offset = 0): Message[] {
    return this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
      )
      .all(sessionId, limit, offset) as Message[];
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }

  // Requirement management methods
  createRequirement(sessionId: string, title: string, description?: string): Requirement {
    const insert = this.db.prepare(
      "INSERT INTO requirements (session_id, title, description) VALUES (?, ?, ?)"
    );
    const result = insert.run(sessionId, title, description ?? null);
    return this.getRequirement(result.lastInsertRowid as number)!;
  }

  getRequirement(id: number): Requirement | undefined {
    return this.db
      .prepare("SELECT * FROM requirements WHERE id = ?")
      .get(id) as Requirement | undefined;
  }

  listRequirements(sessionId: string, limit = 50, offset = 0): Requirement[] {
    return this.db
      .prepare(
        "SELECT * FROM requirements WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
      .all(sessionId, limit, offset) as Requirement[];
  }

  updateRequirementStatus(id: number, status: Requirement["status"]): void {
    const stmt = this.db.prepare(
      "UPDATE requirements SET status = ?, updated_at = datetime('now') WHERE id = ?"
    );
    stmt.run(status, id);
  }

  updateRequirementCommit(id: number, commitHash: string): void {
    const stmt = this.db.prepare(
      "UPDATE requirements SET commit_hash = ?, updated_at = datetime('now') WHERE id = ?"
    );
    stmt.run(commitHash, id);
  }

  deleteRequirement(id: number): void {
    this.db.prepare("DELETE FROM requirements WHERE id = ?").run(id);
  }
}
