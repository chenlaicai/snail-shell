/**
 * SOP 模块公开类型
 *
 * 定义 SOP 模板、阶段定义、转移规则的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Repository 接口访问数据
 */

/**
 * SOP 来源类型
 */
export type SopSource = "platform" | "workspace";

/**
 * 验收清单项
 */
export interface StageChecklistItem {
  /** 清单项 ID */
  id: string;
  /** 清单项描述 */
  description: string;
  /** 是否必填 */
  required: boolean;
}

/**
 * 转移守卫类型
 */
export type TransitionGuardType = "requires_artifacts";

/**
 * 转移守卫
 */
export interface TransitionGuard {
  /** 守卫类型 */
  type: TransitionGuardType;
  /** 守卫配置 */
  config: Record<string, unknown>;
}

/**
 * SOP 实体
 */
export interface Sop {
  /** SOP ID */
  id: string;
  /** SOP 来源 */
  source: SopSource;
  /** 来源引用（工作区 ID） */
  source_ref: string | null;
  /** SOP 标识符 */
  key: string;
  /** SOP 名称 */
  name: string;
  /** SOP 描述 */
  description: string | null;
  /** 首个 Stage 标识符 */
  first_stage: string | null;
  /** 共享手册内容 */
  shared_handbook: string | null;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * SOP Stage 定义
 */
export interface SopStageDefinition {
  /** 定义 ID */
  id: string;
  /** 所属 SOP ID */
  sop_id: string;
  /** Stage 标识符 */
  key: string;
  /** Stage 标题 */
  title: string;
  /** 序列号 */
  sequence: number;
  /** 输入要求描述 */
  input_description: string | null;
  **输出要求描述
  output_description: string | null;
  **验收要点
  acceptance_focus: string[];
  **验收清单
  acceptance_checklist: StageChecklistItem[];
}

/**
 * SOP Stage 角色定义
 */
export interface SopStageRoleDefinition {
  /** 角色 ID */
  id: string;
  /** 所属 Stage 定义 ID */
  stage_definition_id: string;
  /** 角色标识符 */
  key: string;
  /** 角色显示名 */
  name: string;
  /** 角色描述 */
  description: string;
  /** 角色手册 */
  handbook: string | null;
  /** 是否为主角色 */
  is_primary: boolean;
  /** 角色数量 */
  count: number;
}

/**
 * SOP 转移边
 */
export interface SopTransition {
  /** 转移 ID */
  id: string;
  /** 所属 SOP ID */
  sop_id: string;
  /** 源 Stage 标识符 */
  from_stage_key: string;
  **目标 Stage 标识符
  to_stage_key: string;
  **转移守卫
  guard: TransitionGuard | null;
}

/**
 * 创建 SOP 输入
 */
export interface CreateSopInput {
  source: SopSource;
  source_ref?: string;
  key: string;
  name: string;
  description?: string;
  first_stage?: string;
  shared_handbook?: string;
}

/**
 * 创建 SOP Stage 定义输入
 */
export interface CreateSopStageDefinitionInput {
  sop_id: string;
  key: string;
  title: string;
  sequence: number;
  input_description?: string;
  output_description?: string;
  acceptance_focus?: string[];
  acceptance_checklist?: StageChecklistItem[];
}

/**
 * 创建 SOP Stage 角色定义输入
 */
export interface CreateSopStageRoleDefinitionInput {
  stage_definition_id: string;
  key: string;
  name: string;
  description?: string;
  handbook?: string;
  is_primary?: boolean;
  count?: number;
}

/**
 * 创建 SOP 转移输入
 */
export interface CreateSopTransitionInput {
  sop_id: string;
  from_stage_key: string;
  to_stage_key: string;
  guard?: TransitionGuard;
}
