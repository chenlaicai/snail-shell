/**
 * SOP Repository 模块
 *
 * 提供 SOP 模板、阶段定义、转移规则的持久化功能。
 *
 * 设计原则：
 * - 类型从 sop 原子模块导入
 * - 实现 SopRepository 接口
 */

// 从原子模块导入类型
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
  SopRepository,
} from "../../../sop";

// 导出实现
export { SqliteSopRepository } from "./sqlite";
