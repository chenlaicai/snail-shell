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

  /**
   * 执行同步事务
   *
   * better-sqlite3 的事务机制是同步的，不支持 async 函数。
   * 如果需要在事务中执行异步操作，应该先完成所有异步操作，
   * 然后在事务中执行同步的数据库操作。
   */
  transactionSync<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * 执行异步事务（兼容接口）
   *
   * 注意：better-sqlite3 的事务是同步的，此方法仅用于接口兼容。
   * 实际的事务操作应该使用 transactionSync。
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // better-sqlite3 不支持 async 事务，直接执行函数
    // 调用者应确保在事务中只执行同步操作
    return fn();
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
