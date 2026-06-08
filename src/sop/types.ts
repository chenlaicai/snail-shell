/** SOP 来源 */
export type SopSource = 'platform' | 'workspace';

/** 检视清单项 */
export interface ChecklistItem {
  /** 清单项唯一标识符 */
  id: string;
  /** 清单项描述 */
  description: string;
}

/** 阶段定义（SOP 中的阶段模板） */
export interface StageDefinition {
  /** 阶段定义 ID */
  id: string;
  /** 所属 SOP ID */
  sop_id: string;
  /** 阶段标识符，如 "design", "development", "review" */
  key: string;
  /** 阶段显示标题 */
  title: string;
  /** 阶段顺序号 */
  sequence: number;
  /** 输入描述（该阶段需要什么输入） */
  input_description?: string;
  /** 输出描述（该阶段产出什么） */
  output_description?: string;
  /** 验收关注点列表 */
  acceptance_focus?: string[];
  /** 验收检视清单 */
  acceptance_checklist?: ChecklistItem[];
}

/** 转移守卫（控制阶段转移的前置条件） */
export interface TransitionGuard {
  /** 守卫类型 */
  type: 'requires_artifacts';
  /** 守卫配置参数 */
  config: Record<string, string>;
}

/** 阶段转移定义（SOP 有向图中的一条边） */
export interface Transition {
  /** 转移定义 ID */
  id: string;
  /** 所属 SOP ID */
  sop_id: string;
  /** 来源阶段 key */
  from_stage_key: string;
  /** 目标阶段 key */
  to_stage_key: string;
  /** 转移守卫（可选） */
  guard?: TransitionGuard;
}

/** SOP 定义（标准操作流程） */
export interface Sop {
  /** SOP ID */
  id: string;
  /** SOP 来源 */
  source: SopSource;
  /** 来源 workspace_id，platform 时为 null */
  source_ref: string | null;
  /** SOP 标识符（从文件名派生） */
  key: string;
  /** SOP 显示名称 */
  name: string;
  /** 入口阶段 key */
  first_stage: string;
  /** 所有角色共享的手册内容 */
  shared_handbook?: string;
}

/** SOP 完整定义（含阶段、转移和角色） */
export interface SopDefinition {
  /** SOP 主体 */
  sop: Sop;
  /** 阶段定义列表 */
  stages: StageDefinition[];
  /** 转移定义列表 */
  transitions: Transition[];
  /** 角色定义列表 */
  roles: SnapshotRoleDefinition[];
}

/** SOP 快照（Issue 创建时冻结的 SOP 副本，后续 SOP 变更不影响已创建的 Issue） */
export interface SopSnapshot {
  /** SOP 主体 */
  sop: Sop;
  /** 阶段定义列表 */
  stages: StageDefinition[];
  /** 转移定义列表 */
  transitions: Transition[];
  /** 角色定义列表（快照时冻结） */
  roles: SnapshotRoleDefinition[];
  /** 快照捕获时间 */
  captured_at: string;
}

/** 快照中的角色定义 */
export interface SnapshotRoleDefinition {
  /** 角色定义 ID */
  id: string;
  /** 所属阶段 key */
  stage_key: string;
  /** 角色标识符 */
  key: string;
  /** 角色显示名称 */
  name: string;
  /** 绑定的 snail 模板 ID */
  snail_template_id: string;
  /** 是否为主角色 */
  is_primary: boolean;
  /** 该角色的实例数量（支持多 agent 同角色） */
  count: number;
  /** 角色专属手册内容 */
  handbook?: string;
}

// ═══════════════════════════════════════════════════════════
// CRUD 输入 DTO（SOP Center 管理用）
// ═══════════════════════════════════════════════════════════

/** 创建 SOP 的输入参数 */
export interface CreateSopInput {
  /** SOP 标识符（也用作文件名） */
  key: string;
  /** SOP 显示名称 */
  name: string;
  /** SOP 描述 */
  description?: string;
  /** 入口阶段 key */
  first_stage: string;
  /** 所有角色共享的手册内容（文件路径或内联内容） */
  shared_handbook?: string;
  /** 阶段定义列表 */
  stages: CreateStageDefinitionInput[];
  /** 转移定义列表 */
  transitions: CreateTransitionInput[];
}

/** 创建阶段定义的输入参数 */
export interface CreateStageDefinitionInput {
  key: string;
  title: string;
  sequence: number;
  input_description?: string;
  output_description?: string;
  acceptance_focus?: string[];
  acceptance_checklist?: ChecklistItem[];
  roles: CreateRoleInput[];
}

/** 创建角色的输入参数 */
export interface CreateRoleInput {
  key: string;
  name: string;
  description?: string;
  is_primary?: boolean;
  count?: number;
  /** 角色专属手册（文件路径或内联内容） */
  handbook?: string;
}

/** 创建转移的输入参数 */
export interface CreateTransitionInput {
  from: string;
  to: string;
  guard?: TransitionGuard;
}

/** 更新 SOP 的输入参数 */
export interface UpdateSopInput {
  sop_id: string;
  name?: string;
  description?: string;
  first_stage?: string;
  shared_handbook?: string;
  stages?: CreateStageDefinitionInput[];
  transitions?: CreateTransitionInput[];
}

