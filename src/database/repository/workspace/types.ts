/**
 * Workspace Repository 类型定义
 *
 * 定义工作区、Issue、Stage 的持久化接口。
 */

/**
 * Stage 状态
 */
export type StageStatus = "in_progress" | "completed" | "cancelled";

/**
 * 工作区实体
 */
export interface Workspace {
  /** 工作区 ID */
  id: string;
  /** 工作区名称 */
  name: string;
  /** 工作区摘要 */
  summary: string | null;
  /** 工作区根目录 */
  workspace_root: string;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * Issue 实体
 */
export interface Issue {
  /** Issue ID */
  id: string;
  /** 所属工作区 ID */
  workspace_id: string;
  /** Issue 标题 */
  title: string;
  /** Issue 摘要 */
  summary: string | null;
  **任务锚点
  task_anchor: string | null;
  **SOP 快照
  sop_snapshot: Record<string, unknown>;
  **角色 Snail 映射
  role_snail_mapping: Record<string, Record<string, string>>;
  **创建时间
  created_at: string;
  **更新时间
  updated_at: string;
  **关闭时间
  closed_at: string | null;
}

/**
 * Stage 实体
 */
export interface Stage {
  /** Stage ID */
  id: string;
  /** 所属工作区 ID */
  workspace_id: string;
  /** 所属 Issue ID */
  issue_id: string;
  /** Stage 定义 ID */
  stage_definition_id: string;
  /** Stage 类型 */
  type: string;
  /** 序列号 */
  sequence: number;
  /** Stage 状态 */
  status: StageStatus;
  /** 输出产物 */
  output_artifacts: Record<string, unknown>;
  **Gate 证据
  gate_evidence: string | null;
  **进入时间
  entered_at: string | null;
  **离开时间
  left_at: string | null;
}

/**
 * 创建工作区输入
 */
export interface CreateWorkspaceInput {
  id: string;
  name: string;
  summary?: string;
  workspace_root: string;
}

/**
 * 创建 Issue 输入
 */
export interface CreateIssueInput {
  id: string;
  workspace_id: string;
  title: string;
  summary?: string;
  task_anchor?: string;
  sop_snapshot?: Record<string, unknown>;
  role_snail_mapping?: Record<string, Record<string, string>>;
}

/**
 * 创建 Stage 输入
 */
export interface CreateStageInput {
  id: string;
  workspace_id: string;
  issue_id: string;
  stage_definition_id: string;
  type: string;
  sequence: number;
  status?: StageStatus;
  output_artifacts?: Record<string, unknown>;
  gate_evidence?: string;
  entered_at?: string;
}

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
