import type Database from "better-sqlite3";

export function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

export function ensureLegacyConversationCompatibilityBeforeSchema(db: Database.Database): void {
  recoverConversationRebuildScratch(db);
  if (!tableExists(db, "conversation")) return;
  ensureConversationOwnerColumns(db);
  ensureConversationKnowledgeGovernanceCompatibility(db);
}

export function ensureConversationOwnerColumns(db: Database.Database): void {
  if (!tableExists(db, "conversation")) return;
  const columns = db.prepare("PRAGMA table_info(conversation)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "owner_type")) {
    db.exec("ALTER TABLE conversation ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'project_stage'");
  }
  if (!columns.some((column) => column.name === "owner_id")) {
    db.exec("ALTER TABLE conversation ADD COLUMN owner_id TEXT");
    db.exec("UPDATE conversation SET owner_id = stage_id WHERE owner_id IS NULL");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_conversation_owner ON conversation(owner_type, owner_id, updated_at)");
}

export function ensureConversationKnowledgeGovernanceCompatibility(db: Database.Database): void {
  if (!tableExists(db, "conversation")) return;
  const columns = db.prepare("PRAGMA table_info(conversation)").all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
  if (!needsConversationRebuild(columns)) return;
  rebuildConversationForKnowledgeGovernance(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_conversation_project_stage ON conversation(project_id, stage_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_conversation_feature_stage ON conversation(feature_id, stage_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_conversation_owner ON conversation(owner_type, owner_id, updated_at)");
}

function needsConversationRebuild(columns: Array<{ name: string; notnull: number }>): boolean {
  const legacyProjectId = columns.find((column) => column.name === "project_id");
  const legacyFeatureId = columns.find((column) => column.name === "feature_id");
  const legacyStageId = columns.find((column) => column.name === "stage_id");
  return Boolean(
    legacyProjectId?.notnull ||
      legacyFeatureId?.notnull ||
      legacyStageId?.notnull ||
      !columns.some((column) => column.name === "owner_type") ||
      !columns.some((column) => column.name === "owner_id")
  );
}

function recoverConversationRebuildScratch(db: Database.Database): void {
  const hasConversation = tableExists(db, "conversation");
  const hasScratch = tableExists(db, "conversation_new");
  if (!hasScratch) return;
  if (hasConversation) {
    db.exec("DROP TABLE conversation_new");
    return;
  }
  db.exec("ALTER TABLE conversation_new RENAME TO conversation");
}

/**
 * 旧库可能来自知识治理改造前的 conversation 结构，仍把 project/feature/stage 视为必填。
 * 知识治理对话必须真实归属到 owner_type=knowledge_governance，因此这里在初始化阶段重建 conversation 表，
 * 把列约束切换到当前语义，而不是依赖运行时给治理对话塞空值。
 */
function rebuildConversationForKnowledgeGovernance(db: Database.Database): void {
  recoverConversationRebuildScratch(db);
  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(CONVERSATION_REBUILD_SQL);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

const CONVERSATION_REBUILD_SQL = `
  CREATE TABLE IF NOT EXISTS conversation_new (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    feature_id TEXT,
    stage_id TEXT,
    owner_type TEXT NOT NULL DEFAULT 'project_stage',
    owner_id TEXT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    default_snail TEXT NOT NULL,
    participating_snails TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    from_conversation_ids TEXT NOT NULL DEFAULT '[]',
    runtime_sessions TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
  );

  INSERT INTO conversation_new (
    id, project_id, feature_id, stage_id, owner_type, owner_id, title, kind, status, default_snail,
    participating_snails, summary, from_conversation_ids, runtime_sessions, created_at, updated_at
  )
  SELECT
    id, project_id, feature_id, stage_id, COALESCE(owner_type, 'project_stage'), COALESCE(owner_id, stage_id),
    title, kind, status, default_snail, participating_snails, summary, from_conversation_ids, runtime_sessions,
    created_at, updated_at
  FROM conversation;

  DROP TABLE conversation;
  ALTER TABLE conversation_new RENAME TO conversation;
`;
