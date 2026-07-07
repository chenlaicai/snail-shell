import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SQLiteDatabase } from "@infra/database";
import { SQLiteIssueTemplateRepository } from "@domain/issue-template/_internal/repository";
import type { Sop } from "@domain/sop/model";
import type { IssueSnailAssignmentPlan } from "@domain/issue/model";
import { Scope } from "@domain/workspace/model";

function createTestSop(): Sop {
  return {
    key: "code-delivery", name: "Code Delivery", description: "Standard code delivery SOP",
    shared_skill: null,
    stage_definitions: [
      { key: "design", title: "Design", description: "Design stage", roles: [{ key: "architect", name: "architect", description: "Architect role", is_primary: true, count: 1, skill: "cd-design", prohibition: null, self_check: null }] },
      { key: "development", title: "Development", description: "Dev stage", roles: [{ key: "developer", name: "developer", description: "Developer role", is_primary: true, count: 1, skill: "cd-development", prohibition: null, self_check: null }] },
    ],
    transitions: [{ from: "design", to: "development", guard: null }],
    scope: Scope.Platform,
  };
}

function createTestPlan(): IssueSnailAssignmentPlan {
  return { design: { architect: "snail-1" }, development: { developer: "snail-1" } };
}

function setupRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
  const db = new SQLiteDatabase(tmpDir);
  /** FK 约束需要 issue 表存在 */
  db.exec(`
    CREATE TABLE IF NOT EXISTS issue (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      sop_snapshot TEXT NOT NULL,
      snail_assignment_plan TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      closed_at TEXT,
      close_summary TEXT
    );
  `);
  const repo = new SQLiteIssueTemplateRepository(db);
  return { tmpDir, db, repo };
}

function insertTestIssue(db: SQLiteDatabase, id: string, workspacePath = "/ws") {
  db.run(
    `INSERT INTO issue (id, workspace_path, title, sop_snapshot, snail_assignment_plan, context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, workspacePath, "Test Issue", "{}", "{}", "{}", new Date().toISOString()],
  );
}

function teardown(db: SQLiteDatabase, tmpDir: string) {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe("SQLiteIssueTemplateRepository - create & findById", () => {
  let tmpDir: string, db: SQLiteDatabase, repo: SQLiteIssueTemplateRepository;
  beforeEach(() => ({ tmpDir, db, repo } = setupRepo()));
  afterEach(() => teardown(db, tmpDir));

  it("creates a template and retrieves it by id", () => {
    const created = repo.create({ workspace_path: "/workspace", title: "Weekly Review", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("Weekly Review");
    expect(created.cron_expression).toBe("0 9 * * 1");
    expect(created.enabled).toBe(true);
    const found = repo.findById(created.id);
    expect(found).toBeDefined();
    expect(found!.sop_snapshot.key).toBe("code-delivery");
    expect(found!.snail_assignment_plan.design.architect).toBe("snail-1");
  });

  it("returns undefined for non-existent id", () => {
    expect(repo.findById("nonexistent")).toBeUndefined();
  });
});

describe("SQLiteIssueTemplateRepository - findAll (B9)", () => {
  let tmpDir: string, db: SQLiteDatabase, repo: SQLiteIssueTemplateRepository;
  beforeEach(() => ({ tmpDir, db, repo } = setupRepo()));
  afterEach(() => teardown(db, tmpDir));

  it("returns templates with last execution status", () => {
    const t1 = repo.create({ workspace_path: "/ws1", title: "T1", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    const t2 = repo.create({ workspace_path: "/ws2", title: "T2", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 10 * * 2" });
    repo.createExecution({ template_id: t1.id, child_issue_id: "issue-1", status: "success", error: null, executed_at: "2026-07-03T09:00:00Z" });
    const all = repo.findAll();
    expect(all).toHaveLength(2);
    const found1 = all.find(t => t.id === t1.id);
    expect(found1!.last_status).toBe("success");
    expect(found1!.last_child_issue_id).toBe("issue-1");
    const found2 = all.find(t => t.id === t2.id);
    expect(found2!.last_status).toBeNull();
  });
});

describe("SQLiteIssueTemplateRepository - update & remove", () => {
  let tmpDir: string, db: SQLiteDatabase, repo: SQLiteIssueTemplateRepository;
  beforeEach(() => ({ tmpDir, db, repo } = setupRepo()));
  afterEach(() => teardown(db, tmpDir));

  it("updates template fields", () => {
    const t = repo.create({ workspace_path: "/ws", title: "Original", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    const updated = repo.update(t.id, { title: "Updated", cron_expression: "0 10 * * 2", enabled: false });
    expect(updated.title).toBe("Updated");
    expect(updated.cron_expression).toBe("0 10 * * 2");
    expect(updated.enabled).toBe(false);
  });

  it("removes template and cascades to executions", () => {
    const t = repo.create({ workspace_path: "/ws", title: "To Delete", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    repo.createExecution({ template_id: t.id, child_issue_id: "issue-1", status: "success", error: null, executed_at: "2026-07-03T09:00:00Z" });
    repo.remove(t.id);
    expect(repo.findById(t.id)).toBeUndefined();
    expect(repo.listExecutions(t.id)).toHaveLength(0);
  });
});

describe("SQLiteIssueTemplateRepository - findEnabled & toggleEnabled", () => {
  let tmpDir: string, db: SQLiteDatabase, repo: SQLiteIssueTemplateRepository;
  beforeEach(() => ({ tmpDir, db, repo } = setupRepo()));
  afterEach(() => teardown(db, tmpDir));

  it("returns only enabled templates", () => {
    const t1 = repo.create({ workspace_path: "/ws", title: "Enabled", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1", enabled: true });
    repo.create({ workspace_path: "/ws", title: "Disabled", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1", enabled: false });
    const enabled = repo.findEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe(t1.id);
  });

  it("toggles enabled status and resets failures on enable", () => {
    const t = repo.create({ workspace_path: "/ws", title: "Test", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    repo.updateSpawned(t.id, "2026-07-03T09:00:00Z", 3);
    repo.toggleEnabled(t.id, false);
    expect(repo.findById(t.id)!.enabled).toBe(false);
    expect(repo.findById(t.id)!.consecutive_failures).toBe(3);
    repo.toggleEnabled(t.id, true);
    expect(repo.findById(t.id)!.enabled).toBe(true);
    expect(repo.findById(t.id)!.consecutive_failures).toBe(0);
  });
});

describe("SQLiteIssueTemplateRepository - executions & children", () => {
  let tmpDir: string, db: SQLiteDatabase, repo: SQLiteIssueTemplateRepository;
  beforeEach(() => ({ tmpDir, db, repo } = setupRepo()));
  afterEach(() => teardown(db, tmpDir));

  it("creates and lists executions", () => {
    const t = repo.create({ workspace_path: "/ws", title: "Test", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    repo.createExecution({ template_id: t.id, child_issue_id: null, status: "failed", error: "SOP not found", executed_at: "2026-07-03T09:00:00Z" });
    repo.createExecution({ template_id: t.id, child_issue_id: "issue-1", status: "success", error: null, executed_at: "2026-07-03T09:01:00Z" });
    const execs = repo.listExecutions(t.id);
    expect(execs).toHaveLength(2);
    expect(execs[0].status).toBe("success");
    expect(execs[1].status).toBe("failed");
  });

  it("updates execution status", () => {
    const t = repo.create({ workspace_path: "/ws", title: "Test", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    const exec = repo.createExecution({ template_id: t.id, child_issue_id: null, status: "failed", error: null, executed_at: "2026-07-03T09:00:00Z" });
    repo.updateExecution(exec.id, "success", "issue-1", null);
    const execs = repo.listExecutions(t.id);
    expect(execs[0].status).toBe("success");
    expect(execs[0].child_issue_id).toBe("issue-1");
  });

  it("inserts and lists children", () => {
    const t = repo.create({ workspace_path: "/ws", title: "Test", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    insertTestIssue(db, "issue-child-1");
    insertTestIssue(db, "issue-child-2");
    repo.insertChild(t.id, "issue-child-1");
    repo.insertChild(t.id, "issue-child-2");
    const children = repo.listChildren(t.id);
    expect(children).toHaveLength(2);
    expect(children.map(c => c.child_issue_id)).toContain("issue-child-1");
    expect(children.map(c => c.child_issue_id)).toContain("issue-child-2");
    expect(children[0].title).toBe("Test Issue");
    expect(children[0].status).toBe("open");
  });

  it("updates last_spawned_at and consecutive_failures", () => {
    const t = repo.create({ workspace_path: "/ws", title: "Test", sop_key: "code-delivery", sop_snapshot: createTestSop(), snail_assignment_plan: createTestPlan(), cron_expression: "0 9 * * 1" });
    repo.updateSpawned(t.id, "2026-07-03T09:00:00Z", 0);
    const found = repo.findById(t.id);
    expect(found!.last_spawned_at).toBe("2026-07-03T09:00:00Z");
    expect(found!.consecutive_failures).toBe(0);
  });
});
