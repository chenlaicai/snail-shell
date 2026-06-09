/**
 * SQLite 数据库连接实现
 *
 * 基于 better-sqlite3 实现数据库连接接口。
 */

import Database from "better-sqlite3";
import type {
  DatabaseConfig,
  DatabaseConnection,
  DatabaseConnectionFactory,
  QueryResult,
} from "./types";

/**
 * SQLite 数据库连接实现
 */
export class SqliteConnection implements DatabaseConnection {
  private db: Database.Database;
  private connected: boolean = true;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path);

    // 配置 WAL 模式
    if (config.walMode !== false) {
      this.db.pragma("journal_mode = WAL");
    }

    // 配置外键约束
    if (config.foreignKeys !== false) {
      this.db.pragma("foreign_keys = ON");
    }

    // 配置超时
    if (config.timeoutMs) {
      this.db.pragma(`busy_timeout = ${config.timeoutMs}`);
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as T[];
      return {
        rows,
        changes: 0,
        lastInsertRowid: 0,
      };
    } catch (error) {
      throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return {
        rows: [],
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (error) {
      throw new Error(`Execute failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  async close(): Promise<void> {
    if (this.connected) {
      this.db.close();
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * SQLite 数据库连接工厂
 */
export class SqliteConnectionFactory implements DatabaseConnectionFactory {
  async create(config: DatabaseConfig): Promise<DatabaseConnection> {
    return new SqliteConnection(config);
  }
}
