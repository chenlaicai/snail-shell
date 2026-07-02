import type {
  ScheduledTask,
  ScheduledTaskExecution,
  ScheduledTaskWithLastExecution,
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput,
} from "@domain/scheduled-task/model";

/** 定时任务端口定义 */
export interface ScheduledTaskPort {
  /** 列出所有任务（含最近一次执行状态） */
  list(): ScheduledTaskWithLastExecution[];

  /** 按 ID 查找 */
  findById(id: string): ScheduledTask | undefined;

  /** 创建任务 */
  create(input: CreateScheduledTaskInput): ScheduledTask;

  /** 更新任务 */
  update(id: string, input: UpdateScheduledTaskInput): ScheduledTask;

  /** 删除任务（硬删除，execution 通过 CASCADE 一并清除） */
  remove(id: string): void;

  /** 获取任务的执行历史 */
  listExecutions(taskId: string): ScheduledTaskExecution[];

  /** 启动调度器（tick 每 60 秒执行一次） */
  start(): void;

  /** 停止调度器 */
  stop(): void;
}
