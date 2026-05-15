import type Database from "better-sqlite3";

export function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
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

/** 为 stage_role_definition 表添加 role persona 列。 */
export function ensureRolePersonaColumns(db: Database.Database): void {
  if (!tableExists(db, "stage_role_definition")) return;
  const columns = db.prepare("PRAGMA table_info(stage_role_definition)").all() as Array<{ name: string }>;

  const addColumn = (name: string, ddl: string) => {
    if (!columns.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE stage_role_definition ADD COLUMN ${ddl}`);
    }
  };

  addColumn("snail_template_id", "snail_template_id TEXT");
  addColumn("name", "name TEXT NOT NULL DEFAULT ''");
  addColumn("description", "description TEXT NOT NULL DEFAULT ''");
  addColumn("capability_expectations", "capability_expectations TEXT NOT NULL DEFAULT '[]'");
  addColumn("preferred_artifact_types", "preferred_artifact_types TEXT NOT NULL DEFAULT '[]'");
}
