/**
 * Feature 模块公开类型
 *
 * 定义文档索引的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Indexer 接口访问 Feature
 */

/**
 * Feature 元数据
 */
export interface FeatureMetadata {
  /** 版本 */
  version: string;
  /** 日期 */
  date: string;
  /** 标签列表 */
  tags: string[];
}

/**
 * Feature 文档
 */
export interface FeatureDocument {
  /** 文档 ID */
  id: string;
  /** 文档路径 */
  path: string;
  /** 文档标题 */
  title: string;
  /** 文档内容 */
  content: string;
  /** 文档元数据 */
  metadata: FeatureMetadata;
}
