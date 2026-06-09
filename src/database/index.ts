/**
 * Database 模块
 *
 * 提供统一的数据库连接管理和 Repository 实现。
 *
 * 架构说明：
 * - connection: 数据库连接管理
 * - schema: Schema 版本管理和迁移
 * - repository: 各领域 Repository 实现
 *
 * 依赖倒置：
 * - 原子模块定义 Repository 接口
 * - database 模块实现这些接口
 * - 原子模块通过接口访问数据库，不依赖具体实现
 */

// ═══ 连接管理 ═══
export type {
  DatabaseConfig,
  DatabaseConnection,
  DatabaseConnectionFactory,
  QueryResult,
} from "./connection/types";

export { SqliteConnection, SqliteConnectionFactory } from "./connection";

// ═══ Schema 管理 ═══
export type { SchemaManager, SchemaVersion } from "./schema/types";

export { SqliteSchemaManager } from "./schema";

// ═══ Repository 接口 ═══
export type {
  // Conversation Repository
  Message,
  MessageEvent,
  MessageContext,
  Conversation,
  MessageDispatch,
  CreateMessageInput,
  CreateMessageEventInput,
  CreateConversationInput,
  CreateMessageDispatchInput,
  MessageRole,
  MessageStatus,
  ConversationKind,
  ConversationStatus,
  MessageEventKind,
  MessageEventCategory,
  ConversationRepository,
} from "./repository/conversation";

export type {
  // Workspace Repository
  Workspace,
  Issue,
  Stage,
  CreateWorkspaceInput,
  CreateIssueInput,
  CreateStageInput,
  StageStatus,
  WorkspaceRepository,
} from "./repository/workspace";

// ═══ Repository 实现 ═══
export { SqliteConversationRepository } from "./repository/conversation";
export { SqliteWorkspaceRepository } from "./repository/workspace";

// ═══ 工厂函数 ═══

import { SqliteConnectionFactory } from "./connection";
import { SqliteSchemaManager } from "./schema";
import { SqliteConversationRepository } from "./repository/conversation";
import { SqliteWorkspaceRepository } from "./repository/workspace";
import type { DatabaseConfig, DatabaseConnection } from "./connection/types";
import type { ConversationRepository } from "./repository/conversation";
import type { WorkspaceRepository } from "./repository/workspace";

/**
 * 数据库管理器
 *
 * 提供统一的数据库访问入口。
 */
export class DatabaseManager {
  private connection: DatabaseConnection | null = null;
  private schemaManager: SqliteSchemaManager | null = null;
  private conversationRepo: ConversationRepository | null = null;
  private workspaceRepo: WorkspaceRepository | null = null;

  /**
   * 初始化数据库
   * @param config 数据库配置
   */
  async initialize(config: DatabaseConfig): Promise<void> {
    // 创建连接
    const factory = new SqliteConnectionFactory();
    this.connection = await factory.create(config);

    // 初始化 Schema
    this.schemaManager = new SqliteSchemaManager(this.connection);
    await this.schemaManager.migrate();

    // 初始化 Repository
    this.conversationRepo = new SqliteConversationRepository(this.connection);
    this.workspaceRepo = new SqliteWorkspaceRepository(this.connection);
  }

  /**
   * 获取 Conversation Repository
   */
  getConversationRepository(): ConversationRepository {
    if (!this.conversationRepo) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.conversationRepo;
  }

  /**
   * 获取 Workspace Repository
   */
  getWorkspaceRepository(): WorkspaceRepository {
    if (!this.workspaceRepo) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.workspaceRepo;
  }

  /**
   * 获取 Schema 管理器
   */
  getSchemaManager(): SqliteSchemaManager {
    if (!this.schemaManager) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.schemaManager;
  }

  /**
   * 获取数据库连接
   */
  getConnection(): DatabaseConnection {
    if (!this.connection) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.connection;
  }

  /**
   * 关闭数据库
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
      this.conversationRepo = null;
      this.workspaceRepo = null;
      this.schemaManager = null;
    }
  }
}

/**
 * 创建数据库管理器
 * @param config 数据库配置
 * @returns 数据库管理器实例
 */
export async function createDatabaseManager(config: DatabaseConfig): Promise<DatabaseManager> {
  const manager = new DatabaseManager();
  await manager.initialize(config);
  return manager;
}
