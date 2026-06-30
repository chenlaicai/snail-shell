import type { Issue, IssueAggregateStatus, AggregatedProgress } from "@domain/issue/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "monitor-scheduler" });

export interface MonitorSchedulerDeps {
  issuePort: IssuePort;
  stagePort: StagePort;
  /** 通知协作系统向父 issue 的 monitor stage 发送消息 */
  notifyParentMonitor(issueId: string, text: string): Promise<void>;
}

/**
 * MonitorScheduler: 系统自动驱动的调度器
 *
 * 通过 CollaborationConsumer 的回调事件驱动（非轮询）。
 * 职责：
 * 1. 聚合子 issue 状态 → 更新父 issue aggregated_status
 * 2. 就绪检查 → 解除阻塞的子 issue，自动创建首个 stage
 * 3. 完成检查 → 所有子 issue 终态 → 推进父 issue 到 integration
 * 4. 失败检查 → 触发自愈逻辑
 */
export class MonitorScheduler {
  constructor(private readonly deps: MonitorSchedulerDeps) {}

  /**
   * 评估父 issue 的 monitor 状态。
   * 在子 issue 的 stage 状态变化（completed/failed/cancelled）时调用。
   */
  async evaluate(parentIssueId: string): Promise<void> {
    const parentIssue = this.deps.issuePort.findIssue(parentIssueId);
    if (!parentIssue || parentIssue.closed_at) return;

    const children = this.deps.issuePort.listChildren(parentIssueId);
    if (children.length === 0) return;

    // 计算聚合状态
    const { status, progress } = this.computeAggregatedStatus(children);
    this.deps.issuePort.updateAggregatedStatus(parentIssueId, status, progress);

    log.info({ parentIssueId, status, progress }, "monitor.evaluated");

    // 就绪检查：解除阻塞的子 issue
    await this.checkAndUnblockChildren(parentIssueId, children);

    // 完成检查：所有子 issue 已完成 → 推进到 integration
    if (status === "completed") {
      await this.advanceToIntegration(parentIssueId);
    }

    // 失败检查：有子 issue 失败且无法自愈 → 通知 PM
    if (status === "failed") {
      const failedChildren = children.filter(c => c.closed_at && c.aggregated_status === "failed");
      const failedList = failedChildren.map(c => `- ${c.title} (${c.id})`).join("\n");
      await this.deps.notifyParentMonitor(parentIssueId, `子 issue 失败，需要人工介入：\n${failedList}`);
    }
  }

  /**
   * 计算聚合状态和进度。
   * 状态聚合规则：
   * - 任一子 issue in_progress → 父 in_progress
   * - 所有子 issue completed → 父 completed
   * - 任一子 issue failed 且自愈失败 → 父 failed
   * - 无可执行子 issue（全被依赖阻塞）→ 父 blocked
   * - 其他 → 父 pending
   */
  computeAggregatedStatus(children: Issue[]): { status: IssueAggregateStatus; progress: AggregatedProgress } {
    const progress: AggregatedProgress = {
      total: children.length,
      completed: 0,
      in_progress: 0,
      failed: 0,
      blocked: 0,
    };

    for (const child of children) {
      if (child.closed_at) {
        if (child.aggregated_status === "failed") {
          progress.failed++;
        } else {
          progress.completed++;
        }
      } else if (this.hasActiveStage(child)) {
        progress.in_progress++;
      } else {
        progress.blocked++;
      }
    }

    let status: IssueAggregateStatus;
    if (progress.in_progress > 0) {
      status = "in_progress";
    } else if (progress.completed === children.length) {
      status = "completed";
    } else if (progress.failed > 0) {
      status = "failed";
    } else if (progress.blocked === children.length) {
      status = "blocked";
    } else {
      status = "pending";
    }

    return { status, progress };
  }

  /**
   * 检查并解除阻塞的子 issue。
   * 当子 issue 的所有依赖已完成时，自动创建首个 stage 并开始调度。
   */
  private async checkAndUnblockChildren(parentIssueId: string, children: Issue[]): Promise<void> {
    for (const child of children) {
      if (child.closed_at) continue; // 已完成或已失败
      if (this.hasActiveStage(child)) continue; // 已在进行中

      // 检查是否就绪（所有依赖已完成）
      if (this.deps.issuePort.isChildIssueReady(child.id)) {
        try {
          const initialStageKey = child.sop_snapshot.stage_definitions[0]?.key;
          if (!initialStageKey) {
            log.warn({ childIssueId: child.id }, "child has no stage definitions");
            continue;
          }
          this.deps.stagePort.createStage({ issue_id: child.id, key: initialStageKey });
          log.info({ childIssueId: child.id, stageKey: initialStageKey }, "child_issue.stage_created");
        } catch (err) {
          log.error({ childIssueId: child.id, err }, "failed to create initial stage for child issue");
        }
      }
    }
  }

  /**
   * 推进父 issue 从 monitor 到 integration stage。
   */
  private async advanceToIntegration(parentIssueId: string): Promise<void> {
    const activeStageId = this.deps.stagePort.listStages(parentIssueId).find(s => !s.left_at)?.id;
    if (!activeStageId) {
      log.warn({ parentIssueId }, "no active stage found for parent issue");
      return;
    }
    const activeStage = this.deps.stagePort.findStage(activeStageId);
    if (!activeStage || activeStage.key !== "monitor") {
      log.warn({ parentIssueId, activeStageKey: activeStage?.key }, "parent issue not in monitor stage");
      return;
    }

    const hasIntegrationTransition = activeStage.available_transitions.some(t => t.to === "integration");
    if (!hasIntegrationTransition) {
      log.warn({ parentIssueId }, "no integration transition available from monitor stage");
      return;
    }

    try {
      this.deps.stagePort.advanceStage(activeStage.id, "integration");
      log.info({ parentIssueId, fromStage: "monitor", toStage: "integration" }, "parent_issue.advanced_to_integration");
      await this.deps.notifyParentMonitor(parentIssueId, "所有子 issue 已完成，已推进到 integration 阶段。");
    } catch (err) {
      log.error({ parentIssueId, err }, "failed to advance parent issue to integration");
    }
  }

  /** 检查 issue 是否有活跃的（未离开的）stage */
  private hasActiveStage(issue: Issue): boolean {
    const stages = this.deps.stagePort.listStages(issue.id);
    return stages.some(s => !s.left_at);
  }
}
