import type { Sop, RoleDefinition } from "@domain/sop/model";

export type StageSnailAssignmentPlan = Record<string, string>;
export type IssueSnailAssignmentPlan = Record<string, StageSnailAssignmentPlan>;

// ── Issue ─────────────────────────────────────────────────────────────

export interface Issue {
  id: string;
  workspace_path: string;
  title: string;
  summary: string | null;
  sop_snapshot: Sop;
  snail_assignment_plan: IssueSnailAssignmentPlan;
  /** 可扩展上下文：由创建方注入的额外上下文数据，传递给底层 agent */
  extendable_context: Record<string, unknown>;
  /** 任务锚：结构化记录本质目标、反目标、语义不变量和成功标准 */
  task_anchor: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface CreateIssueInput {
  workspace_path: string;
  title: string;
  summary?: string;
  adopted_sop_key: string;
  snail_assignment_plan: IssueSnailAssignmentPlan;
  extendable_context?: Record<string, unknown>;
}

// ── Stage ─────────────────────────────────────────────────────────────

/** 从 SOP Transition 筛选出的当前 Stage 可用转换 */
export interface StageTransition {
  to: string;
  guard: string | null;
}

export interface Stage {
  id: string;
  workspace_path: string;
  issue_id: string;

  /** SOP StageDefinition.key，如 "design"、"development" */
  key: string;

  /** 对话标题 */
  title: string;

  /** 阶段描述（来自 SOP StageDefinition.description） */
  description: string;

  /** 默认响应的角色实例（is_primary 角色的第一个实例） */
  default_role_instance: string;

  /** 所有 Agent 角色实例，如 ["开发者", "审查者-1", "审查者-2"] */
  role_instances: string[];

  /** 前驱 Stage ID，形成链路。首个 Stage 为 null */
  from_stage_id: string | null;

  /** 当前 Stage 可用的转换（从 SOP transitions 筛选 from=stage.key） */
  available_transitions: StageTransition[];

  /** 本阶段产出的产物（key: 产物名, value: 路径/链接等），用于 transition guard 判断 */
  output_artifacts: Record<string, string>;

  /** 进入时间 */
  entered_at: string;

  /** 离开时间（推进到下一个 Stage 时设置） */
  left_at: string | null;
}

export interface CreateStageInput {
  issue_id: string;
  key: string;
  from_stage_id?: string | null;
}

// ── RoleSnailAssignment ──────────────────────────────────────────────────
// 追踪每个角色实例的 snail 分配和 session 历史。
// append-only，seq 标识交接链。当前状态 = 最高 seq 的记录。

export interface RoleSnailAssignment {
  stage_id: string;
  role_instance: string;
  /** 递增序号，0=初始分配，切换 snail 时 +1 */
  seq: number;
  snail_key: string;
  /** snail 实例 ID（snail_key#随机6位），首次调用后填入 */
  snail_instance_id: string | null;
  /** SOP RoleDefinition.key，如 "reviewer" */
  role_key: string;
  description: string;
  created_at: string;
}

// ── Stage Preview ─────────────────────────────────────────────────────

export interface StagePreview {
  key: string;
  title: string;
  description: string;
  available_transitions: StageTransition[];
  role_instances: RoleInstancePreview[];
}

export interface RoleInstancePreview {
  role_key: string;
  role_instance: string;
  description: string;
}

// ── Role Instance 展开 ────────────────────────────────────────────────

/**
 * 将 SOP 角色定义展开为角色实例名称列表。
 * count=1 → [name]
 * count=N → [name+"-1", name+"-2", ..., name+"-N"]
 */
export function expandRoleInstances(roles: RoleDefinition[]): string[] {
  const instances: string[] = [];
  for (const role of roles) {
    if (role.count <= 1) {
      instances.push(role.name);
    } else {
      for (let i = 1; i <= role.count; i++) {
        instances.push(`${role.name}-${i}`);
      }
    }
  }
  return instances;
}

/**
 * 从角色定义中推导默认角色实例。
 * 找到 is_primary 的角色类型，返回其第一个实例名称。
 * 无 primary 时返回第一个角色的第一个实例。
 */
export function resolveDefaultRoleInstance(roles: RoleDefinition[]): string {
  const primary = roles.find(r => r.is_primary) ?? roles[0];
  if (!primary) throw new Error("SOP stage has no roles defined");
  return primary.count <= 1 ? primary.name : `${primary.name}-1`;
}
