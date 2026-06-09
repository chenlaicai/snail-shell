/**
 * Workspace 模块公开类型
 *
 * 定义工作区、Issue、Stage 的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Repository 接口访问数据
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
  /** 任务锚点 */
  task_anchor: string | null;
  /** SOP 快照 */
  sop_snapshot: Record<string, unknown>;
  /** 角色 Snail 映射 */
  role_snail_mapping: Record<string, Record<string, string>>;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
  /** 关闭时间 */
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
  /** Gate 证据 */
  gate_evidence: string | null;
  /** 进入时间 */
  entered_at: string | null;
  /** 离开时间 */
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
