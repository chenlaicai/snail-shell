import type Database from "better-sqlite3";

export function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

export function ensureFeatureTaskAnchorColumn(db: Database.Database): void {
  if (!tableExists(db, "feature")) return;
  const columns = db.prepare("PRAGMA table_info(feature)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "task_anchor")) {
    db.exec("ALTER TABLE feature ADD COLUMN task_anchor TEXT");
  }
}
