/**
 * 数据库连接管理类型定义
 *
 * 提供统一的数据库连接接口，支持事务管理和连接池。
 */

/**
 * 数据库连接配置
 */
export interface DatabaseConfig {
  /** SQLite 数据库文件路径 */
  path: string;
  /** 是否启用 WAL 模式 */
  walMode?: boolean;
  /** 是否启用外键约束 */
  foreignKeys?: boolean;
  /** 连接超时时间（毫秒） */
  timeoutMs?: number;
}

/**
 * 数据库查询结果类型
 */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * 数据库连接接口
 *
 * 提供统一的数据库操作方法，支持事务管理。
 */
export interface DatabaseConnection {
  /**
   * 执行查询语句
   * @param sql SQL 语句
   * @param params 查询参数
   * @returns 查询结果
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /**
   * 执行更新语句
   * @param sql SQL 语句
   * @param params 查询参数
   * @returns 查询结果（包含 changes 和 lastInsertRowid）
   */
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;

  /**
   * 在事务中执行操作
   * @param fn 事务操作函数
   * @returns 事务结果
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * 关闭数据库连接
   */
  close(): Promise<void>;

  /**
   * 获取数据库连接状态
   */
  isConnected(): boolean;
}

/**
 * 数据库连接工厂接口
 *
 * 用于创建数据库连接实例。
 */
export interface DatabaseConnectionFactory {
  /**
   * 创建数据库连接
   * @param config 数据库配置
   * @returns 数据库连接实例
   */
  create(config: DatabaseConfig): Promise<DatabaseConnection>;
}
