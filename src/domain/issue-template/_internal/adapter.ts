import { CronExpressionParser } from "cron-parser";
import { getLogger } from "@infra/logger";
import type { IssueTemplatePort } from "@domain/issue-template/port";
import type { CreateIssuePort } from "@domain/issue-template/port";
import type { IssueTemplateRepository } from "@domain/issue-template/_internal/repository";
import type {
  IssueTemplate,
  IssueTemplateWithLastExecution,
  IssueTemplateExecution,
  IssueTemplateChild,
  CreateIssueTemplateInput,
  UpdateIssueTemplateInput,
} from "@domain/issue-template/model";
import { validateSnailAssignmentPlan } from "@domain/issue/_internal/adapter";

const log = getLogger({ module: "issue-template" });

const TICK_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export class IssueTemplateAdapter implements IssueTemplatePort {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private repo: IssueTemplateRepository,
    private collaboration: CreateIssuePort,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────

  list(): IssueTemplateWithLastExecution[] {
    return this.repo.findAll();
  }

  findById(id: string): IssueTemplate | undefined {
    return this.repo.findById(id);
  }

  create(input: CreateIssueTemplateInput): IssueTemplate {
    validateCronExpression(input.cron_expression);
    validateSnailAssignmentPlan(input.sop_snapshot, input.snail_assignment_plan);
    return this.repo.create(input);
  }

  update(id: string, input: UpdateIssueTemplateInput): IssueTemplate {
    const existing = this.repo.findById(id);
    if (!existing) throw new Error(`IssueTemplate not found: ${id}`);

    const sop = input.sop_snapshot ?? existing.sop_snapshot;
    const plan = input.snail_assignment_plan ?? existing.snail_assignment_plan;

    if (input.cron_expression !== undefined) {
      validateCronExpression(input.cron_expression);
    }
    if (input.sop_snapshot !== undefined || input.snail_assignment_plan !== undefined) {
      validateSnailAssignmentPlan(sop, plan);
    }

    return this.repo.update(id, input);
  }

  remove(id: string): void {
    this.repo.remove(id);
  }

  toggle(id: string): IssueTemplate {
    const existing = this.repo.findById(id);
    if (!existing) throw new Error(`IssueTemplate not found: ${id}`);
    const newEnabled = !existing.enabled;
    this.repo.toggleEnabled(id, newEnabled);
    return this.repo.findById(id)!;
  }

  listExecutions(templateId: string): IssueTemplateExecution[] {
    return this.repo.listExecutions(templateId);
  }

  listChildren(templateId: string): IssueTemplateChild[] {
    return this.repo.listChildren(templateId);
  }

  // ── Scheduler ──────────────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    /** catch-up: 立即执行一次 tick，补执行错失的调度 */
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.timer.unref();
    log.info("issue-template scheduler started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("issue-template scheduler stopped");
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const templates = this.repo.findEnabled();
      for (const template of templates) {
        try {
          if (this.shouldFire(template)) {
            await this.spawnChildIssue(template);
          }
        } catch (err) {
          log.error({ err, templateId: template.id }, "issue-template per-template tick error");
        }
      }
    } catch (err) {
      log.error({ err }, "issue-template tick error");
    } finally {
      this.ticking = false;
    }
  }

  /** 判断 cron 表达式的下次触发时间是否已过 */
  private shouldFire(template: IssueTemplate): boolean {
    const now = new Date();
    const lastSpawned = template.last_spawned_at ?? template.created_at;
    try {
      const interval = CronExpressionParser.parse(template.cron_expression, {
        currentDate: new Date(lastSpawned),
      });
      const nextFire = interval.next().toDate();
      return nextFire <= now;
    } catch {
      /** 无效的 cron 表达式不应该出现在 enabled 模板中（create/update 时已验证） */
      log.error({ templateId: template.id, cron: template.cron_expression }, "invalid cron expression in enabled template");
      return false;
    }
  }

  private async spawnChildIssue(template: IssueTemplate): Promise<void> {
    const now = new Date().toISOString();
    const execution = this.repo.createExecution({
      template_id: template.id,
      child_issue_id: null,
      status: "failed",
      error: null,
      executed_at: now,
    });

    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const result = await this.collaboration.createIssue({
        workspace_path: template.workspace_path,
        title: `${template.title} - ${dateStr}`,
        adopted_sop_key: template.sop_key,
        /** D10: 传递母体冻结的 SOP 快照，子实例继承母体版本 */
        sop_snapshot: template.sop_snapshot,
        snail_assignment_plan: template.snail_assignment_plan,
        context: { parent_template_id: template.id },
      });

      this.repo.insertChild(template.id, result.issue.id);
      this.repo.updateExecution(execution.id, "success", result.issue.id, null);
      this.repo.updateSpawned(template.id, now, 0);
      log.info({ templateId: template.id, childIssueId: result.issue.id }, "issue-template.spawned");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const failures = template.consecutive_failures + 1;
      this.repo.updateExecution(execution.id, "failed", null, errorMsg);
      this.repo.updateSpawned(template.id, template.last_spawned_at ?? template.created_at, failures);

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        this.repo.toggleEnabled(template.id, false);
        log.error({ templateId: template.id, failures }, "issue-template auto-disabled after consecutive failures");
      } else {
        log.error({ templateId: template.id, err: errorMsg, failures }, "issue-template spawn failed");
      }
    }
  }
}

function validateCronExpression(expr: string): void {
  if (!expr || expr.trim() === "") {
    throw new Error("cron_expression is required");
  }
  try {
    CronExpressionParser.parse(expr);
  } catch {
    throw new Error(`Invalid cron expression: ${expr}`);
  }
}
