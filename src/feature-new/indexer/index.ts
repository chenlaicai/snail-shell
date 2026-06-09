/**
 * Feature Indexer 接口
 *
 * 定义文档索引器的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问 Feature
 */

import type { FeatureDocument } from "../types";

/**
 * Feature Indexer 接口
 *
 * 定义文档索引器的操作。
 */
export interface FeatureIndexer {
  /**
   * 重建索引
   */
  rebuildIndex(): Promise<void>;

  /**
   * 更新索引
   * @param filePath 文件路径
   */
  updateIndex(filePath: string): Promise<void>;

  /**
   * 搜索文档
   * @param query 搜索关键词
   * @returns 文档列表
   */
  search(query: string): Promise<FeatureDocument[]>;
}
