import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "database" });

/**
 * 数据库基础设施。
 * 封装 SQLite 操作，提供通用的 CRUD 能力。
 *
 * 目录结构由 infra 层管理：data/database/snail-shell.db
 * 调用方只需传入 repoRoot，不需要知道 DB 文件在哪。
 */
export class SQLiteDatabase {
  private db: Database.Database;

  constructor(repoRoot: string) {
    const dbDir = path.join(repoRoot, "data", "database");
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, "snail-shell.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** 执行 SQL，返回 lastInsertRowid */
  run(sql: string, params?: unknown[]): number {
    if (params) {
      const result = this.db.prepare(sql).run(...params);
      return Number(result.lastInsertRowid);
    }
    const result = this.db.prepare(sql).run();
    return Number(result.lastInsertRowid);
  }

  /** 查询单行 */
  get<T>(sql: string, params?: unknown[]): T | undefined {
    if (params) {
      return this.db.prepare(sql).get(...params) as T | undefined;
    }
    return this.db.prepare(sql).get() as T | undefined;
  }

  /** 查询多行 */
  all<T>(sql: string, params?: unknown[]): T[] {
    if (params) {
      return this.db.prepare(sql).all(...params) as T[];
    }
    return this.db.prepare(sql).all() as T[];
  }

  /** 事务执行 */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** 初始化表结构 */
  initSchema(schema: string): void {
    this.db.exec(schema);
  }

  /** 关闭数据库 */
  close(): void {
    try {
      this.db.close();
    } catch (err) {
      log.error({ err }, "Close failed");
    }
  }

  /** 执行 DDL/DML（用于 FTS5 虚拟表等场景） */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** 预编译语句（用于 FTS5 等需要 prepared statement 的场景） */
  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }
}
