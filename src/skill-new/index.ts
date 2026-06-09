/**
 * Skill 模块
 *
 * 提供 Skill 注册和查询的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - registry: Registry 接口定义
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Registry 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问 Skill
 */

// ═══ 公开类型 ═══
export type { SkillDefinition } from "./types";

// ═══ Registry 接口 ═══
export type { SkillRegistry } from "./registry";
