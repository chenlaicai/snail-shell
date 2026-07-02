import { randomUUID } from "crypto";
import type {
  ScheduledTask,
  ScheduledTaskExecution,
  ScheduledTaskWithLastExecution,
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput,
} from "@domain/scheduled-task/model";
import type { ScheduledTaskPort } from "@domain/scheduled-task/port";
import type { ScheduledTaskRepository } from "@domain/scheduled-task/_internal/repository";
import type { SopPort } from "@domain/sop/port";
import type { SnailPort } from "@domain/snail/port";
import type { IssuePort } from "@domain/issue/port";
import type { IssueSnailAssignmentPlan } from "@domain/issue/model";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "scheduled-task" });

const TICK_INTERVAL_MS = 60_000;

/** 定时任务调度器适配器 */
export class ScheduledTaskAdapter implements ScheduledTaskPort {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private repo: ScheduledTaskRepository,
    private sopPort: SopPort,
    private snailPort: SnailPort,
    private issuePort: IssuePort,
    private collaboration: CollaborationInput,
  ) {}

  list(): ScheduledTaskWithLastExecution[] {
    return this.repo.findAll();
  }

  findById(id: string): ScheduledTask | undefined {
    return this.repo.findById(id);
  }

  create(input: CreateScheduledTaskInput): ScheduledTask {
    if (input.interval_days <= 0) {
      throw new Error("interval_days must be greater than 0");
    }
    if (!input.key.trim()) {
      throw new Error("key must not be empty");
    }

    const existing = this.repo.findByKey(input.key);
    if (existing) {
      throw new Error(`Scheduled task with key "${input.key}" already exists`);
    }

    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: randomUUID(),
      key: input.key,
      title: input.title,
      sop_key: input.sop_key,
      workspace_path: input.workspace_path,
      interval_days: input.interval_days,
      enabled: input.enabled ?? true,
      created_at: now,
      updated_at: now,
    };

    this.repo.create(task);
    return task;
  }

  update(id: string, input: UpdateScheduledTaskInput): ScheduledTask {
    const task = this.repo.findById(id);
    if (!task) throw new Error(`Scheduled task not found: ${id}`);

    if (input.interval_days !== undefined && input.interval_days <= 0) {
      throw new Error("interval_days must be greater than 0");
    }

    this.repo.update(id, { ...input, updated_at: new Date().toISOString() });
    const updated = this.repo.findById(id);
    if (!updated) throw new Error(`Scheduled task disappeared after update: ${id}`);
    return updated;
  }

  remove(id: string): void {
    const task = this.repo.findById(id);
    if (!task) throw new Error(`Scheduled task not found: ${id}`);
    this.repo.remove(id);
  }

  listExecutions(taskId: string): ScheduledTaskExecution[] {
    return this.repo.listExecutions(taskId);
  }

  start(): void {
    if (this.timer) return;
    log.info("Starting scheduled task scheduler");

    /** 启动时立即执行一次 tick（catch-up 机制） */
    void this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    /** 不阻塞进程退出 */
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("Scheduled task scheduler stopped");
    }
  }

  /** 评估所有活跃任务，满足条件的执行 */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const tasks = this.repo.findPendingExecutions();
      for (const task of tasks) {
        try {
          await this.evaluateAndExecute(task);
        } catch (err) {
          log.error({ err, taskId: task.id }, "Error evaluating scheduled task");
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /** 判断任务是否满足执行条件，满足则执行 */
  private async evaluateAndExecute(task: ScheduledTask): Promise<void> {
    const lastExec = this.repo.findLastExecution(task.id);
    const baseline = lastExec?.executed_at ?? task.created_at;
    const elapsedMs = Date.now() - new Date(baseline).getTime();
    const intervalMs = task.interval_days * 24 * 60 * 60 * 1000;

    if (elapsedMs < intervalMs) return;

    await this.executeTask(task);
  }

  /** 执行单个任务：创建 Issue 并调用 agent */
  private async executeTask(task: ScheduledTask): Promise<void> {
    const now = new Date().toISOString();

    /** 先记录执行意图（pending），再创建 Issue */
    const execution: ScheduledTaskExecution = {
      id: randomUUID(),
      task_id: task.id,
      issue_id: null,
      status: "pending",
      error: null,
      executed_at: now,
    };
    this.repo.createExecution(execution);

    log.info({ taskId: task.id, key: task.key, executionId: execution.id }, "Executing scheduled task");

    try {
      const { issue } = await this.collaboration.createIssue({
        workspace_path: task.workspace_path,
        title: `[Scheduled] ${task.title}`,
        summary: `定时任务自动触发：${task.title}`,
        adopted_sop_key: task.sop_key,
        snail_assignment_plan: this.buildDefaultSnailPlan(task.sop_key),
      });

      this.repo.updateExecutionStatus(execution.id, "success", null);
      log.info({ taskId: task.id, issueId: issue.id }, "Scheduled task executed successfully");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.repo.updateExecutionStatus(execution.id, "failed", errorMsg);
      log.error({ err, taskId: task.id }, "Scheduled task execution failed");
    }
  }

  /** 根据 SOP 构建默认 snail 分配计划 */
  private buildDefaultSnailPlan(sopKey: string): IssueSnailAssignmentPlan {
    const sop = this.sopPort.findByKey(sopKey);
    if (!sop) throw new Error(`SOP not found: ${sopKey}`);

    const snails = this.snailPort.list();
    if (snails.length === 0) throw new Error("No snails configured");

    const snailKey = snails[0].key;
    const plan: IssueSnailAssignmentPlan = {};

    for (const stageDef of sop.stage_definitions) {
      plan[stageDef.key] = {};
      for (const role of stageDef.roles) {
        const count = role.count ?? 1;
        if (count <= 1) {
          plan[stageDef.key][role.name] = snailKey;
        } else {
          for (let i = 1; i <= count; i++) {
            plan[stageDef.key][`${role.name}-${i}`] = snailKey;
          }
        }
      }
    }

    return plan;
  }
}
