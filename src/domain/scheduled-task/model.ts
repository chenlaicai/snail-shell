/** 定时任务实体 */
export interface ScheduledTask {
  id: string;
  /** 唯一标识，如 "code-quality-check" */
  key: string;
  title: string;
  /** 关联的 SOP key */
  sop_key: string;
  workspace_path: string;
  /** 每隔 N 天触发，必须 > 0 */
  interval_days: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** 定时任务执行记录 */
export interface ScheduledTaskExecution {
  id: string;
  /** 关联 ScheduledTask.id */
  task_id: string;
  /** 创建的 Issue ID（失败时为 null） */
  issue_id: string | null;
  status: "pending" | "success" | "failed";
  error: string | null;
  executed_at: string;
}

/** 创建定时任务输入 */
export interface CreateScheduledTaskInput {
  key: string;
  title: string;
  sop_key: string;
  workspace_path: string;
  interval_days: number;
  enabled?: boolean;
}

/** 更新定时任务输入 */
export interface UpdateScheduledTaskInput {
  title?: string;
  sop_key?: string;
  workspace_path?: string;
  interval_days?: number;
  enabled?: boolean;
}

/** 定时任务列表项（含最近一次执行状态） */
export interface ScheduledTaskWithLastExecution extends ScheduledTask {
  last_status: ScheduledTaskExecution["status"] | null;
  last_issue_id: string | null;
}
