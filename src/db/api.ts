/**
 * DB 基础设施 — 连接管理 + Schema 初始化。
 *
 * 薄薄一层，不含业务逻辑。各域 Repo 通过本模块获取 DB 实例。
 */

import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

let _db: Database.Database | null = null;

/** 获取 DB 单例（懒初始化） */
export function getDb(dbPath?: string): Database.Database {
  if (!_db) {
    const resolvedPath = dbPath ?? './data/snail-shell.db';
    _db = new Database(resolvedPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

/** 初始化 Schema（CREATE TABLE IF NOT EXISTS） */
export function initSchema(db?: Database.Database): void {
  const target = db ?? getDb();
  target.exec(SCHEMA_SQL);
}

/** 关闭 DB 连接 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
