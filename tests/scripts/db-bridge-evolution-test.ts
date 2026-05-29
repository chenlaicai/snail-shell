import assert from "assert";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-db-bridge-evolution.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// Setup: create a minimal DB with required tables
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const setupDb = new Database(TEST_DB);
setupDb.pragma("journal_mode = WAL");

// Seed required tables
setupDb.exec(`
  CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, name TEXT, summary TEXT, project_root TEXT, guard_profile TEXT, module TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS feature (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, summary TEXT, task_anchor TEXT, role_snail_mapping TEXT, closed_at TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS stage (id TEXT PRIMARY KEY, project_id TEXT, feature_id TEXT, stage_definition_id TEXT, type TEXT, sequence INTEGER, status TEXT, output_artifacts TEXT, entered_at TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS conversation (id TEXT PRIMARY KEY, project_id TEXT, feature_id TEXT, stage_id TEXT, kind TEXT, title TEXT, owner_type TEXT, owner_id TEXT, summary TEXT, status TEXT, default_role TEXT, participating_roles TEXT, from_conversation_ids TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS evolution_item (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, content TEXT, tags TEXT, metadata TEXT, feature_id TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS project_stage_definition (id TEXT PRIMARY KEY, project_id TEXT, key TEXT, title TEXT, sequence INTEGER, input_description TEXT, output_description TEXT, acceptance_focus TEXT);
  CREATE TABLE IF NOT EXISTS stage_role_definition (id TEXT PRIMARY KEY, stage_definition_id TEXT, key TEXT, name TEXT, description TEXT, working_rules TEXT, is_primary INTEGER DEFAULT 0);
  CREATE VIRTUAL TABLE IF NOT EXISTS evolution_item_search USING fts5(evolution_item_id UNINDEXED, project_id UNINDEXED, status UNINDEXED, title, content);
`);

// Seed evolution-center project and stage definitions
setupDb.prepare("INSERT INTO project (id, name) VALUES (?, ?)").run("evolution-center", "Evolution Center");
setupDb.prepare("INSERT INTO project_stage_definition (id, project_id, key, title, sequence, acceptance_focus) VALUES (?, ?, ?, ?, ?, ?)").run(
  "evolution-center-development", "evolution-center", "development", "研发迭代", 1, "[]"
);
setupDb.prepare("INSERT INTO stage_role_definition (id, stage_definition_id, key, name, description, working_rules, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  "role-evolution-exec", "evolution-center-development", "exec", "演进执行者", "演进治理执行者", "[]", 1
);

setupDb.close();

// Execute db-bridge CLI to test real skill wrapper path
const bridgePath = path.resolve(__dirname, "..", "..", ".meta", "scripts", "db-bridge.js");

try {
  // Run db-bridge --mode evolution-create via CLI
  const result = execFileSync("node", [
    bridgePath,
    "--mode", "evolution-create",
    "--project-id", "test-project",
    "--title", "Test Evolution Item",
    "--content", "Test content for evolution",
    "--tags", '["test-tag"]',
  ], {
    encoding: "utf-8",
    env: { ...process.env, DB_PATH: TEST_DB },
    timeout: 10000,
  });

  const parsed = JSON.parse(result);
  assert.ok(parsed.ok, "evolutionCandidate.create should return ok=true");
  assert.ok(parsed.evolution_item_id, "should return evolution_item_id");
  assert.ok(parsed.feature_id, "should return feature_id");
  assert.ok(parsed.conversation_id, "should return conversation_id");

  // Open DB directly to verify conversation properties
  const verifyDb = new Database(TEST_DB, { readonly: true });
  try {
    const conv = verifyDb.prepare("SELECT * FROM conversation WHERE id = ?").get(parsed.conversation_id) as any;
    assert.ok(conv, "conversation should exist");
    assert.equal(conv.default_role, "演进执行者", "default_role should be 演进执行者");
    assert.equal(conv.project_id, "evolution-center", "conversation project_id should be evolution-center");

    // Verify evolution_item retains source project_id
    const item = verifyDb.prepare("SELECT * FROM evolution_item WHERE id = ?").get(parsed.evolution_item_id) as any;
    assert.equal(item.project_id, "test-project", "evolution_item should retain source project_id");

    // Verify feature belongs to evolution-center
    const feature = verifyDb.prepare("SELECT * FROM feature WHERE id = ?").get(parsed.feature_id) as any;
    assert.equal(feature.project_id, "evolution-center", "feature project_id should be evolution-center");

    // Verify stage belongs to evolution-center
    const stage = verifyDb.prepare("SELECT * FROM stage WHERE feature_id = ?").get(parsed.feature_id) as any;
    assert.equal(stage.project_id, "evolution-center", "stage project_id should be evolution-center");
    assert.equal(stage.stage_definition_id, "evolution-center-development", "stage definition should be evolution-center-development");
  } finally {
    verifyDb.close();
  }

  console.log("All db-bridge evolution-create tests passed.");
} finally {
  removeDbFiles(TEST_DB);
}
