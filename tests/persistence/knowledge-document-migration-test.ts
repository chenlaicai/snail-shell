import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { ConversationStore } from "../../src/persistence/store";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-knowledge-document-migration.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
fs.rmSync(TEST_DB, { force: true });

const legacyDb = new Database(TEST_DB);
legacyDb.exec(`
  CREATE TABLE knowledge_item (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    scope_type TEXT NOT NULL,
    scope_ref TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate',
    governance_level TEXT NOT NULL DEFAULT 'L0',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    rationale TEXT,
    created_by TEXT,
    approved_by TEXT,
    approved_at TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
legacyDb.close();

const store = new ConversationStore(TEST_DB);
try {
  const columns = (store as any).db.prepare("PRAGMA table_info(knowledge_item)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  assert(columnNames.has("document_path"), "migration should add document_path before creating its index");
  assert(columnNames.has("document_hash"), "migration should add document_hash to legacy knowledge_item");
  assert(columnNames.has("runtime_state"), "migration should add runtime_state before creating its index");
  const indexes = (store as any).db.prepare("PRAGMA index_list(knowledge_item)").all() as Array<{ name: string }>;
  assert(indexes.some((index) => index.name === "idx_knowledge_document_path"), "migration should create document_path index after adding the column");
  assert(indexes.some((index) => index.name === "idx_knowledge_runtime_state"), "migration should create runtime_state index after adding the column");
} finally {
  store.close();
  fs.rmSync(TEST_DB, { force: true });
}

console.log("knowledge document migration tests passed");
