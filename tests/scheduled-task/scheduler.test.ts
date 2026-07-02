import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScheduledTaskPort } from "@domain/scheduled-task/port";
import type { ScheduledTaskRepository } from "@domain/scheduled-task/_internal/repository";
import type { SopPort } from "@domain/sop/port";
import type { SnailPort } from "@domain/snail/port";
import type { IssuePort } from "@domain/issue/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import type { ScheduledTask } from "@domain/scheduled-task/model";
import { ScheduledTaskAdapter } from "@domain/scheduled-task/_internal/adapter";
import { randomUUID } from "crypto";

function createMockRepo(overrides?: Partial<ScheduledTaskRepository>): ScheduledTaskRepository {
  return {
    findAll: vi.fn().mockReturnValue([]),
    findById: vi.fn(),
    findByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    findPendingExecutions: vi.fn().mockReturnValue([]),
    findLastExecution: vi.fn(),
    listExecutions: vi.fn().mockReturnValue([]),
    createExecution: vi.fn(),
    updateExecutionStatus: vi.fn(),
    ...overrides,
  };
}

function createMockSopPort(): SopPort {
  return {
    list: vi.fn().mockReturnValue([]),
    findByKey: vi.fn().mockReturnValue({
      key: "test-sop",
      name: "Test SOP",
      stage_definitions: [
        { key: "design", title: "Design", roles: [{ name: "开发者", is_primary: true, count: 1 }] },
      ],
    }),
    findByWorkspace: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

function createMockSnailPort(): SnailPort {
  return {
    list: vi.fn().mockReturnValue([{ key: "claude-code-stateful", name: "Claude" }]),
    findByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    invokeFirstCall: vi.fn(),
    invokeResume: vi.fn(),
  };
}

function createMockIssuePort(): IssuePort {
  return {
    findIssue: vi.fn(),
    listIssues: vi.fn(),
    previewSopStages: vi.fn().mockReturnValue([]),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn(),
    updateCloseSummary: vi.fn(),
  };
}

function createMockCollaboration(): CollaborationInput {
  return {
    createIssue: vi.fn().mockResolvedValue({
      issue: { id: "issue-1" },
      stage: { id: "stage-1" },
    }),
    sendMessage: vi.fn(),
    interruptMessage: vi.fn(),
    registerIssueConsumer: vi.fn(),
    unregisterIssueConsumer: vi.fn(),
    registerWorkspaceConsumer: vi.fn(),
    unregisterWorkspaceConsumer: vi.fn(),
    listStageTransitionSuggestions: vi.fn().mockReturnValue([]),
    dismissSuggestion: vi.fn(),
    advanceStage: vi.fn(),
    rollbackStage: vi.fn(),
    getStageAuditTrail: vi.fn().mockReturnValue([]),
    closeIssue: vi.fn(),
    isInvoking: vi.fn().mockReturnValue(false),
    getActivityStatus: vi.fn().mockReturnValue("needs_human"),
    resumeRoute: vi.fn(),
    restoreSuggestions: vi.fn(),
  };
}

function makeTask(overrides?: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: randomUUID(),
    key: "test-task",
    title: "Test Task",
    sop_key: "test-sop",
    workspace_path: "/test/workspace",
    interval_days: 7,
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("ScheduledTaskAdapter", () => {
  let repo: ScheduledTaskRepository;
  let sopPort: SopPort;
  let snailPort: SnailPort;
  let issuePort: IssuePort;
  let collaboration: CollaborationInput;
  let adapter: ScheduledTaskPort;

  beforeEach(() => {
    repo = createMockRepo();
    sopPort = createMockSopPort();
    snailPort = createMockSnailPort();
    issuePort = createMockIssuePort();
    collaboration = createMockCollaboration();
    adapter = new ScheduledTaskAdapter(repo, sopPort, snailPort, issuePort, collaboration);
  });

  describe("create", () => {
    it("creates a task with valid input", () => {
      vi.mocked(repo.findByKey).mockReturnValue(undefined);
      const task = adapter.create({
        key: "code-quality-check",
        title: "Code Quality Check",
        sop_key: "test-sop",
        workspace_path: "/test",
        interval_days: 7,
      });

      expect(task.key).toBe("code-quality-check");
      expect(task.title).toBe("Code Quality Check");
      expect(task.interval_days).toBe(7);
      expect(task.enabled).toBe(true);
    });

    it("rejects interval_days <= 0", () => {
      expect(() => adapter.create({
        key: "bad-task",
        title: "Bad",
        sop_key: "test-sop",
        workspace_path: "/test",
        interval_days: 0,
      })).toThrow("interval_days must be greater than 0");

      expect(() => adapter.create({
        key: "bad-task",
        title: "Bad",
        sop_key: "test-sop",
        workspace_path: "/test",
        interval_days: -1,
      })).toThrow("interval_days must be greater than 0");
    });

    it("rejects empty key", () => {
      expect(() => adapter.create({
        key: "  ",
        title: "Bad",
        sop_key: "test-sop",
        workspace_path: "/test",
        interval_days: 7,
      })).toThrow("key must not be empty");
    });

    it("rejects duplicate key", () => {
      vi.mocked(repo.findByKey).mockReturnValue(makeTask({ key: "existing" }));
      expect(() => adapter.create({
        key: "existing",
        title: "Duplicate",
        sop_key: "test-sop",
        workspace_path: "/test",
        interval_days: 7,
      })).toThrow('already exists');
    });
  });

  describe("update", () => {
    it("updates an existing task and returns updated result", () => {
      const task = makeTask();
      vi.mocked(repo.findById).mockReturnValue(task);
      vi.mocked(repo.findById).mockReturnValueOnce(task).mockReturnValueOnce({ ...task, title: "Updated" });
      const result = adapter.update(task.id, { title: "Updated" });
      expect(result.title).toBe("Updated");
    });

    it("rejects update of non-existent task", () => {
      vi.mocked(repo.findById).mockReturnValue(undefined);
      expect(() => adapter.update("nonexistent", { title: "X" })).toThrow("not found");
    });

    it("rejects interval_days <= 0 on update", () => {
      vi.mocked(repo.findById).mockReturnValue(makeTask());
      expect(() => adapter.update("id", { interval_days: 0 })).toThrow("interval_days must be greater than 0");
    });
  });

  describe("remove", () => {
    it("removes an existing task", () => {
      vi.mocked(repo.findById).mockReturnValue(makeTask());
      adapter.remove("task-id");
      /** 验证后续 findById 返回 undefined（任务已被删除） */
      vi.mocked(repo.findById).mockReturnValue(undefined);
      expect(adapter.findById("task-id")).toBeUndefined();
    });

    it("rejects removal of non-existent task", () => {
      vi.mocked(repo.findById).mockReturnValue(undefined);
      expect(() => adapter.remove("nonexistent")).toThrow("not found");
    });
  });

  describe("tick evaluation (via start)", () => {
    /** B2: 距上次执行超过间隔时触发 */
    it("triggers task when interval exceeded", async () => {
      const task = makeTask({ interval_days: 1 });
      vi.mocked(repo.findPendingExecutions).mockReturnValue([task]);
      /** 无执行记录 → 用 created_at 作为基准，设置为 2 天前 */
      vi.mocked(repo.findLastExecution).mockReturnValue(undefined);
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      task.created_at = twoDaysAgo;

      adapter.start();
      /** 等待 tick 完成 */
      await new Promise((r) => setTimeout(r, 100));
      adapter.stop();

      /** 验证创建了执行记录且 Issue 创建被触发 */
      expect(vi.mocked(repo.createExecution).mock.calls.length).toBe(1);
      expect(vi.mocked(collaboration.createIssue).mock.results.length).toBe(1);
    });

    /** B4: 新创建的任务不会立即触发 */
    it("does not trigger task when interval not exceeded", async () => {
      const task = makeTask({ interval_days: 7 });
      task.created_at = new Date().toISOString();
      vi.mocked(repo.findPendingExecutions).mockReturnValue([task]);
      vi.mocked(repo.findLastExecution).mockReturnValue(undefined);

      adapter.start();
      await new Promise((r) => setTimeout(r, 100));
      adapter.stop();

      expect(vi.mocked(repo.createExecution).mock.results.length).toBe(0);
      expect(vi.mocked(collaboration.createIssue).mock.results.length).toBe(0);
    });

    /** B1: 重启后补执行 */
    it("catches up missed executions on start", async () => {
      const task = makeTask({ interval_days: 1 });
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      task.created_at = tenDaysAgo;
      vi.mocked(repo.findPendingExecutions).mockReturnValue([task]);
      vi.mocked(repo.findLastExecution).mockReturnValue(undefined);

      adapter.start();
      await new Promise((r) => setTimeout(r, 100));
      adapter.stop();

      expect(vi.mocked(collaboration.createIssue).mock.results.length).toBe(1);
    });

    /** B3: 创建 Issue 失败时记录失败日志 */
    it("records failure when createIssue throws", async () => {
      const task = makeTask({ interval_days: 1 });
      task.created_at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      vi.mocked(repo.findPendingExecutions).mockReturnValue([task]);
      vi.mocked(repo.findLastExecution).mockReturnValue(undefined);
      vi.mocked(collaboration.createIssue).mockRejectedValue(new Error("Network error"));

      adapter.start();
      await new Promise((r) => setTimeout(r, 100));
      adapter.stop();

      /** 验证创建了执行记录，并且状态被更新为 failed */
      expect(vi.mocked(repo.createExecution).mock.results.length).toBe(1);
      const updateCalls = vi.mocked(repo.updateExecutionStatus).mock.calls;
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][1]).toBe("failed");
      expect(updateCalls[0][2]).toBe("Network error");
    });

    /** 串行执行：多个任务不并发 */
    it("executes multiple tasks serially", async () => {
      const task1 = makeTask({ id: "t1", key: "task-1", interval_days: 1 });
      const task2 = makeTask({ id: "t2", key: "task-2", interval_days: 1 });
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      task1.created_at = twoDaysAgo;
      task2.created_at = twoDaysAgo;
      vi.mocked(repo.findPendingExecutions).mockReturnValue([task1, task2]);
      vi.mocked(repo.findLastExecution).mockReturnValue(undefined);

      adapter.start();
      await new Promise((r) => setTimeout(r, 200));
      adapter.stop();

      /** 验证两个任务都被执行了 */
      expect(vi.mocked(collaboration.createIssue).mock.results.length).toBe(2);
    });
  });
});
