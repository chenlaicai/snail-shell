/**
 * Workspace Repository 接口
 *
 * 定义工作区、Issue、Stage 的持久化操作接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问数据库
 */

import type {
  Workspace,
  Issue,
  Stage,
  CreateWorkspaceInput,
  CreateIssueInput,
  CreateStageInput,
  StageStatus,
} from "../types";

/**
 * Workspace Repository 接口
 *
 * 定义工作区、Issue、Stage 的持久化操作。
 */
export interface WorkspaceRepository {
  // ═══ Workspace CRUD ═══

  /**
   * 获取工作区
   * @param id 工作区 ID
   * @returns 工作区实体，不存在返回 null
   */
  getWorkspace(id: string): Promise<Workspace | null>;

  /**
   * 获取工作区列表
   * @param limit 限制数量
   * @param offset 偏移量
   * @returns 工作区列表
   */
  listWorkspaces(limit?: number, offset?: number): Promise<Workspace[]>;

  /**
   * 保存工作区
   * @param workspace 工作区实体
   */
  saveWorkspace(workspace: CreateWorkspaceInput): Promise<Workspace>;

  // ═══ Issue CRUD ═══

  /**
   * 获取 Issue
   * @param id Issue ID
   * @returns Issue 实体，不存在返回 null
   */
  getIssue(id: string): Promise<Issue | null>;

  /**
   * 获取工作区的 Issue 列表
   * @param workspaceId 工作区 ID
   * @returns Issue 列表
   */
  listIssues(workspaceId: string): Promise<Issue[]>;

  /**
   * 保存 Issue
   * @param issue Issue 实体
   */
  saveIssue(issue: CreateIssueInput): Promise<Issue>;

  /**
   * 更新 Issue
   * @param id Issue ID
   * @param updates 更新内容
   */
  updateIssue(id: string, updates: Partial<Issue>): Promise<void>;

  // ═══ Stage CRUD ═══

  /**
   * 获取 Stage
   * @param id Stage ID
   * @returns Stage 实体，不存在返回 null
   */
  getStage(id: string): Promise<Stage | null>;

  /**
   * 获取 Issue 的 Stage 列表
   * @param issueId Issue ID
   * @returns Stage 列表
   */
  listStages(issueId: string): Promise<Stage[]>;

  /**
   * 保存 Stage
   * @param stage Stage 实体
   */
  saveStage(stage: CreateStageInput): Promise<Stage>;

  /**
   * 更新 Stage 状态
   * @param id Stage ID
   * @param status 新状态
   */
  updateStageStatus(id: string, status: StageStatus): Promise<void>;

  // ═══ 查询方法 ═══

  /**
   * 根据名称查找工作区
   * @param name 工作区名称
   * @returns 工作区实体，不存在返回 null
   */
  findWorkspaceByName(name: string): Promise<Workspace | null>;

  /**
   * 获取 Issue 的所有 Stage
   * @param issueId Issue ID
   * @returns Stage 列表
   */
  getIssueStages(issueId: string): Promise<Stage[]>;
}
