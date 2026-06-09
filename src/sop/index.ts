/**
 * SOP 模块
 *
 * 提供 SOP 模板、阶段定义、转移规则的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - repository: Repository 接口定义
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Repository 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问数据库
 */

// ═══ 公开类型 ═══
export type {
  Sop,
  SopStageDefinition,
  SopStageRoleDefinition,
  SopTransition,
  CreateSopInput,
  CreateSopStageDefinitionInput,
  CreateSopStageRoleDefinitionInput,
  CreateSopTransitionInput,
  SopSource,
  StageChecklistItem,
  TransitionGuard,
  TransitionGuardType,
} from "./types";

// ═══ Repository 接口 ═══
export type { SopRepository } from "./repository";
