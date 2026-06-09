/**
 * Prompt 模块
 *
 * 提供提示词构建、匹配、组装的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - builder: Builder 接口定义
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Builder 接口
 * - database 模块实现这些接口
 * - 本模块通过接口构建提示词
 */

// ═══ 公开类型 ═══
export type {
  PromptDocument,
  PromptMetadata,
  PromptBuildContext,
} from "./types";

// ═══ Builder 接口 ═══
export type { PromptBuilder } from "./builder";
