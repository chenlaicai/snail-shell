import Database from "better-sqlite3";

/**
 * 数据库基础设施。
 * 封装 SQLite 操作，提供通用的 CRUD 能力。
 */
export class SQLiteDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** 执行 SQL（无返回值） */
  run(sql: string, params?: unknown[]): void {
    if (params) {
      this.db.prepare(sql).run(...params);
    } else {
      this.db.prepare(sql).run();
    }
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
    this.db.close();
  }
}
