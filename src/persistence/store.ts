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
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    `);
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

  addMessage(sessionId: string, role: string, content: string): Message {
    const insert = this.db.prepare(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
    );
    const updateSession = this.db.prepare(
      "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?"
    );

    const transaction = this.db.transaction(
      (sid: string, r: string, c: string) => {
        const result = insert.run(sid, r, c);
        updateSession.run(sid);
        return result;
      }
    );

    transaction(sessionId, role, content);

    const { id } = this.db
      .prepare("SELECT last_insert_rowid() as id")
      .get() as { id: number };
    return this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as Message;
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
}
