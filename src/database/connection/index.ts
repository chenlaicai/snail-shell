/**
 * 数据库连接模块
 *
 * 提供统一的数据库连接管理。
 */

export type {
  DatabaseConfig,
  DatabaseConnection,
  DatabaseConnectionFactory,
  QueryResult,
} from "./types";

export { SqliteConnection, SqliteConnectionFactory } from "./sqlite";
