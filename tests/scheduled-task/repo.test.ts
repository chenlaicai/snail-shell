import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteDatabase } from "@infra/database";
import { SQLiteScheduledTaskRepository } from "@domain/scheduled-task/_internal/repository";
import type { ScheduledTask, ScheduledTaskExecution } from "@domain/scheduled-task/model";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

function makeTask(overrides?: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: randomUUID(),
    key: "test-task",
    title: "Test Task",
    sop_key: "test-sop",
    workspace_path: "/test/workspace",
    interval_days: 7,
    enabled: true,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function makeExecution(taskId: string, overrides?: Partial<ScheduledTaskExecution>): ScheduledTaskExecution {
  return {
    id: randomUUID(),
    task_id: taskId,
    issue_id: null,
    status: "pending",
    error: null,
    executed_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("SQLiteScheduledTaskRepository", () => {
  let db: SQLiteDatabase;
  let repo: SQLiteScheduledTaskRepository;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
    db = new SQLiteDatabase(tmpDir);
    repo = new SQLiteScheduledTaskRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("create and findById", () => {
    it("creates and retrieves a task", () => {
      const task = makeTask();
      repo.create(task);
      const found = repo.findById(task.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(task.id);
      expect(found!.key).toBe(task.key);
      expect(found!.enabled).toBe(true);
    });

    it("returns undefined for non-existent id", () => {
      expect(repo.findById("nonexistent")).toBeUndefined();
    });
  });

  describe("findByKey", () => {
    it("finds task by unique key", () => {
      const task = makeTask({ key: "unique-key" });
      repo.create(task);
      const found = repo.findByKey("unique-key");
      expect(found).toBeDefined();
      expect(found!.key).toBe("unique-key");
    });
  });

  describe("findAll", () => {
    it("returns all tasks with last execution status", () => {
      const task1 = makeTask({ key: "task-1" });
      const task2 = makeTask({ key: "task-2" });
      repo.create(task1);
      repo.create(task2);

      /** B9: 列表返回任务及其最近一次执行状态 */
      const exec = makeExecution(task1.id, { status: "success", issue_id: "issue-1" });
      repo.createExecution(exec);

      const all = repo.findAll();
      expect(all).toHaveLength(2);

      const withExec = all.find((t) => t.id === task1.id);
      expect(withExec!.last_status).toBe("success");
      expect(withExec!.last_issue_id).toBe("issue-1");

      const withoutExec = all.find((t) => t.id === task2.id);
      expect(withoutExec!.last_status).toBeNull();
      expect(withoutExec!.last_issue_id).toBeNull();
    });
  });

  describe("update", () => {
    it("updates task fields", () => {
      const task = makeTask();
      repo.create(task);
      repo.update(task.id, { title: "Updated Title", interval_days: 14, updated_at: "2026-07-02T00:00:00Z" });
      const updated = repo.findById(task.id);
      expect(updated!.title).toBe("Updated Title");
      expect(updated!.interval_days).toBe(14);
    });

    it("can toggle enabled", () => {
      const task = makeTask({ enabled: true });
      repo.create(task);
      repo.update(task.id, { enabled: false, updated_at: "2026-07-02T00:00:00Z" });
      const updated = repo.findById(task.id);
      expect(updated!.enabled).toBe(false);
    });
  });

  describe("remove", () => {
    it("removes task and cascades executions", () => {
      const task = makeTask();
      repo.create(task);
      repo.createExecution(makeExecution(task.id));
      repo.createExecution(makeExecution(task.id, { status: "success" }));

      repo.remove(task.id);
      expect(repo.findById(task.id)).toBeUndefined();
      expect(repo.listExecutions(task.id)).toHaveLength(0);
    });
  });

  describe("executions", () => {
    it("creates and retrieves executions", () => {
      const task = makeTask();
      repo.create(task);

      const exec1 = makeExecution(task.id, { executed_at: "2026-07-01T00:00:00Z" });
      const exec2 = makeExecution(task.id, { executed_at: "2026-07-02T00:00:00Z", status: "success", issue_id: "issue-1" });
      repo.createExecution(exec1);
      repo.createExecution(exec2);

      const execs = repo.listExecutions(task.id);
      expect(execs).toHaveLength(2);
      /** 按 executed_at DESC 排序 */
      expect(execs[0].executed_at).toBe("2026-07-02T00:00:00Z");
    });

    it("findLastExecution returns the most recent", () => {
      const task = makeTask();
      repo.create(task);

      repo.createExecution(makeExecution(task.id, { executed_at: "2026-07-01T00:00:00Z" }));
      repo.createExecution(makeExecution(task.id, { executed_at: "2026-07-03T00:00:00Z", status: "success" }));

      const last = repo.findLastExecution(task.id);
      expect(last!.executed_at).toBe("2026-07-03T00:00:00Z");
      expect(last!.status).toBe("success");
    });

    it("updateExecutionStatus changes status and error", () => {
      const task = makeTask();
      repo.create(task);
      const exec = makeExecution(task.id);
      repo.createExecution(exec);

      repo.updateExecutionStatus(exec.id, "failed", "Something went wrong");
      const execs = repo.listExecutions(task.id);
      expect(execs[0].status).toBe("failed");
      expect(execs[0].error).toBe("Something went wrong");
    });
  });

  describe("findPendingExecutions", () => {
    it("returns only enabled tasks", () => {
      repo.create(makeTask({ key: "enabled-task", enabled: true }));
      repo.create(makeTask({ key: "disabled-task", enabled: false }));

      const pending = repo.findPendingExecutions();
      expect(pending).toHaveLength(1);
      expect(pending[0].key).toBe("enabled-task");
    });
  });
});
