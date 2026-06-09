/**
 * Schema 管理类型定义
 *
 * 提供数据库 Schema 版本管理和迁移功能。
 */

/**
 * Schema 版本信息
 */
export interface SchemaVersion {
  /** 版本号 */
  version: number;
  /** 版本描述 */
  description: string;
  /** 迁移 SQL */
  sql: string;
}

/**
 * Schema 管理器接口
 *
 * 负责数据库 Schema 的版本管理和迁移。
 */
export interface SchemaManager {
  /**
   * 获取当前 Schema 版本
   * @returns 当前版本号
   */
  getVersion(): Promise<number>;

  /**
   * 执行 Schema 迁移
   * @param targetVersion 目标版本号，不指定则迁移到最新版本
   */
  migrate(targetVersion?: number): Promise<void>;

  /**
   * 检查是否需要迁移
   * @returns 是否需要迁移
   */
  needsMigration(): Promise<boolean>;

  /**
   * 获取所有可用的迁移版本
   * @returns 迁移版本列表
   */
  getAvailableMigrations(): SchemaVersion[];
}
