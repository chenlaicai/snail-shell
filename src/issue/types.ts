import type { SopSnapshot } from '@/sop/types.js';

/** 阶段状态 */
export type StageStatus = 'in_progress' | 'completed' | 'cancelled';

/** 检视清单验证结果（单个清单项的通过/未通过） */
export interface ChecklistArtifact {
  /** 对应的清单项 ID */
  checklist_item_id: string;
  /** 是否通过 */
  passed: boolean;
  /** 未通过时的原因说明 */
  reason?: string;
}

/** 门控证据（AI 自检结果，用于阶段转移验证） */
export interface GateEvidence {
  /** 各清单项的验证结果 */
  artifacts: ChecklistArtifact[];
  /** 验证时间 */
  checked_at: string;
  /** 验证者标识 */
  checked_by: string;
}

/** Issue 工作项（一个工作任务的运行时实例） */
export interface Issue {
  /** Issue ID */
  id: string;
  /** 所属工作区 ID */
  workspace_id: string;
  /** Issue 标题 */
  title: string;
  /** Issue 摘要 */
  summary?: string;
  /** 结构化目标描述 */
  task_anchor?: TaskAnchor;
  /** 冻结的 SOP 快照（Issue 创建时捕获，后续 SOP 变更不影响） */
  sop_snapshot: SopSnapshot;
  /** role_key -> snail_template_id 映射（快照时冻结） */
  role_snail_mapping: Record<string, string>;
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
  /** 关闭时间（未关闭时为 undefined） */
  closed_at?: string;
}

/** 结构化目标描述 */
export interface TaskAnchor {
  /** 目标描述 */
  goal: string;
  /** 反目标（明确不做什么） */
  anti_goals?: string[];
  /** 约束条件 */
  constraints?: string[];
}

/** 阶段实例（Issue 中的具体执行阶段） */
export interface Stage {
  /** 阶段实例 ID */
  id: string;
  /** 所属工作区 ID */
  workspace_id: string;
  /** 所属 Issue ID */
  issue_id: string;
  /** 对应 SOP 中的 stage_definition ID */
  stage_definition_id: string;
  /** 对应 SOP 中的 stage_definition key */
  type: string;
  /** 阶段顺序号 */
  sequence: number;
  /** 阶段状态 */
  status: StageStatus;
  /** 产出物（JSON map，key 为产出物标识） */
  output_artifacts?: Record<string, unknown>;
  /** 门控证据（阶段完成时的自检结果） */
  gate_evidence?: GateEvidence;
  /** 进入时间 */
  entered_at: string;
  /** 离开时间（进行中时为 undefined） */
  left_at?: string;
}
