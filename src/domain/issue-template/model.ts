import type { Sop } from "@domain/sop/model";
import type { IssueSnailAssignmentPlan } from "@domain/issue/model";

// ── IssueTemplate (母体) ─────────────────────────────────────────────

export interface IssueTemplate {
  id: string;
  workspace_path: string;
  title: string;
  /** SOP key（传递给 createIssue() 的 adopted_sop_key） */
  sop_key: string;
  /** SOP 快照（创建时深拷贝，用于 UI 展示和 plan 验证） */
  sop_snapshot: Sop;
  /** 角色-Snail 分配计划（JSON） */
  snail_assignment_plan: IssueSnailAssignmentPlan;
  /** cron 表达式（5 位：分 时 日 月 周） */
  cron_expression: string;
  enabled: boolean;
  /** 上次创建子实例的时间 */
  last_spawned_at: string | null;
  /** 连续失败次数，>= 3 时自动禁用 */
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface CreateIssueTemplateInput {
  workspace_path: string;
  title: string;
  sop_key: string;
  sop_snapshot: Sop;
  snail_assignment_plan: IssueSnailAssignmentPlan;
  cron_expression: string;
  enabled?: boolean;
}

export interface UpdateIssueTemplateInput {
  title?: string;
  sop_key?: string;
  sop_snapshot?: Sop;
  snail_assignment_plan?: IssueSnailAssignmentPlan;
  cron_expression?: string;
  enabled?: boolean;
}

/** 列表查询结果，附带最近一次执行状态 */
export interface IssueTemplateWithLastExecution extends IssueTemplate {
  last_status: "success" | "failed" | null;
  last_child_issue_id: string | null;
}

// ── Execution (调度执行记录) ─────────────────────────────────────────

export interface IssueTemplateExecution {
  id: string;
  template_id: string;
  /** 创建的子实例 Issue ID（失败时为 null） */
  child_issue_id: string | null;
  status: "success" | "failed";
  error: string | null;
  executed_at: string;
}

// ── Children (母体-子实例关联) ───────────────────────────────────────

export interface IssueTemplateChild {
  template_id: string;
  child_issue_id: string;
  title: string;
  status: "open" | "closed";
  workspace_path: string;
  created_at: string;
}
