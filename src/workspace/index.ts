/**
 * Workspace 模块
 *
 * 提供工作区、Issue、Stage 的领域功能。
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
  Workspace,
  Issue,
  Stage,
  CreateWorkspaceInput,
  CreateIssueInput,
  CreateStageInput,
  StageStatus,
} from "./types";

// ═══ Repository 接口 ═══
export type { WorkspaceRepository } from "./repository";
