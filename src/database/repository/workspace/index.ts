/**
 * Workspace Repository 模块
 *
 * 提供工作区、Issue、Stage 的持久化功能。
 *
 * 设计原则：
 * - 类型从 workspace 原子模块导入
 * - 实现 WorkspaceRepository 接口
 */

// 从原子模块导入类型
export type {
  Workspace,
  Issue,
  Stage,
  CreateWorkspaceInput,
  CreateIssueInput,
  CreateStageInput,
  StageStatus,
  WorkspaceRepository,
} from "../../../workspace";

// 导出实现
export { SqliteWorkspaceRepository } from "./sqlite";
