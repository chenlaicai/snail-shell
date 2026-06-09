/**
 * Feature 模块
 *
 * 提供文档索引的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - indexer: Indexer 接口定义
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Indexer 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问 Feature
 */

// ═══ 公开类型 ═══
export type {
  FeatureDocument,
  FeatureMetadata,
} from "./types";

// ═══ Indexer 接口 ═══
export type { FeatureIndexer } from "./indexer";
