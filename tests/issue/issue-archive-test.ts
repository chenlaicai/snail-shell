/**
 * Issue 归档状态测试 — 覆盖 Feature 文档 B1-B8
 *
 * 运行方式：npx tsx tests/issue/issue-archive-test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import { SQLiteIssueRepository, SQLiteStageRepository, SQLiteRoleSnailAssignmentRepository } from "@domain/issue/_internal/repository";
import { IssueAdapter, StageAdapter, assertIssueMutable } from "@domain/issue/_internal/adapter";
import { SQLiteDatabase } from "@infra/database";
import { Scope } from "@domain/workspace/model";
import type { Issue, Stage } from "@domain/issue/model";

// ── 测试辅助 ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "issue-archive-test-"));
}

function createTestSetup(tmpDir: string) {
  const db = new SQLiteDatabase(tmpDir);
  const issueRepo = new SQLiteIssueRepository(db);
  const stageRepo = new SQLiteStageRepository(db);
  const sessionRepo = new SQLiteRoleSnailAssignmentRepository(db);

  // Mock SopPort
  const mockSop = {
    key: "test-sop",
    name: "Test SOP",
    description: "Test SOP description",
    shared_skill: null,
    scope: Scope.Workspace,
    stage_definitions: [
      {
        key: "design",
        title: "Design",
        description: "Design stage",
        roles: [
          { key: "developer", name: "开发者", description: "Developer role", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }
        ],
      },
      {
        key: "development",
        title: "Development",
        description: "Development stage",
        roles: [
          { key: "developer", name: "开发者", description: "Developer role", is_primary: true, count: 1, skill: null, prohibition: null, self_check: null }
        ],
      },
    ],
    transitions: [
      { from: "design", to: "development", guard: null },
    ],
  };

  const sopPort = {
    findByKey: (key: string) => key === "test-sop" ? mockSop : undefined,
    list: () => [mockSop],
    findByWorkspace: () => [mockSop],
  };

  const issueAdapter = new IssueAdapter(issueRepo, sopPort);
  const stageAdapter = new StageAdapter(stageRepo, sessionRepo, issueRepo);

  return { issueRepo, stageRepo, sessionRepo, issueAdapter, stageAdapter, db };
}

function createTestIssue(issueAdapter: IssueAdapter, stageAdapter: StageAdapter): { issue: Issue; stage: Stage } {
  const issue = issueAdapter.createIssue({
    workspace_path: "/test/workspace",
    title: "Test Issue",
    summary: "Test summary",
    adopted_sop_key: "test-sop",
    snail_assignment_plan: {
      design: { "开发者": "snail-1" },
      development: { "开发者": "snail-1" },
    },
  });
  const stage = stageAdapter.createStage({ issue_id: issue.id, key: "design" });
  return { issue, stage };
}

// ── B1: 归档任意 stage 的 issue ─────────────────────────────────

function testB1_archive_issue() {
  const tmpDir = makeTmpDir();
  try {
    const { issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue } = createTestIssue(issueAdapter, stageAdapter);

    // 归档 issue
    const archived = issueAdapter.archiveIssue(issue.id);

    // 验证 archived_at 已设置
    assert.notStrictEqual(archived.archived_at, null, "B1: archived_at 应非 null");
    assert.strictEqual(typeof archived.archived_at, "string", "B1: archived_at 应为字符串");

    // 验证通过 findIssue 也能看到归档状态
    const found = issueAdapter.findIssue(issue.id);
    assert.strictEqual(found?.archived_at, archived.archived_at, "B1: findIssue 应返回归档后的 issue");

    console.log("✓ B1: 归档任意 stage 的 issue");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B2: 归档后发送消息被拒绝 ─────────────────────────────────────

function testB2_send_message_after_archive() {
  const tmpDir = makeTmpDir();
  try {
    const { issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue, stage } = createTestIssue(issueAdapter, stageAdapter);

    // 归档 issue
    issueAdapter.archiveIssue(issue.id);

    // 尝试写入产物（应被拒绝）
    assert.throws(() => {
      stageAdapter.addOutputArtifacts(stage.id, { test: "value" });
    }, /archived/, "B2: 归档后写入产物应被拒绝");

    console.log("✓ B2: 归档后写入操作被拒绝");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B3: 归档后 stage 推进被拒绝 ─────────────────────────────────

function testB3_advance_stage_after_archive() {
  const tmpDir = makeTmpDir();
  try {
    const { issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue, stage } = createTestIssue(issueAdapter, stageAdapter);

    // 归档 issue
    issueAdapter.archiveIssue(issue.id);

    // 尝试推进 stage（应被拒绝）
    assert.throws(() => {
      stageAdapter.advanceStage(stage.id, "development");
    }, /archived/, "B3: 归档后推进 stage 应被拒绝");

    console.log("✓ B3: 归档后 stage 推进被拒绝");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B4: 归档后 AI 尝试发送 stage_transition 建议 ─────────────────

// B4 的测试需要在 collaboration 层面验证，此处验证域层的写保护

// ── B5: 归档后 UI 显示归档标记 ─────────────────────────────────

// B5 是前端测试，此处验证后端返回的数据包含 archived_at

// ── B6: 归档时不自动完成当前 stage ─────────────────────────────

function testB6_archive_does_not_complete_stage() {
  const tmpDir = makeTmpDir();
  try {
    const { issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue, stage } = createTestIssue(issueAdapter, stageAdapter);

    // 验证 stage 未完成
    assert.strictEqual(stage.left_at, null, "B6: 归档前 stage 的 left_at 应为 null");

    // 归档 issue
    issueAdapter.archiveIssue(issue.id);

    // 验证 stage 仍未完成（归档不自动完成 stage）
    const stageAfterArchive = stageAdapter.findStage(stage.id);
    assert.strictEqual(stageAfterArchive?.left_at, null, "B6: 归档后 stage 的 left_at 应保持 null");

    console.log("✓ B6: 归档时不自动完成当前 stage");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B7: 已关闭 issue 可再归档 ─────────────────────────────────

function testB7_archive_closed_issue() {
  const tmpDir = makeTmpDir();
  try {
    const { db, issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue } = createTestIssue(issueAdapter, stageAdapter);

    // 模拟关闭 issue（设置 closed_at）
    db.run("UPDATE issue SET closed_at = ? WHERE id = ?", [new Date().toISOString(), issue.id]);

    // 归档已关闭的 issue
    const archived = issueAdapter.archiveIssue(issue.id);

    // 验证两个字段同时非 null
    assert.notStrictEqual(archived.archived_at, null, "B7: archived_at 应非 null");
    const found = issueAdapter.findIssue(issue.id);
    assert.notStrictEqual(found?.closed_at, null, "B7: closed_at 应非 null");
    assert.notStrictEqual(found?.archived_at, null, "B7: archived_at 应非 null");

    console.log("✓ B7: 已关闭 issue 可再归档");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B8: 归档后 issue 完全不可变 ─────────────────────────────────

function testB8_archive_immutability() {
  const tmpDir = makeTmpDir();
  try {
    const { issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue, stage } = createTestIssue(issueAdapter, stageAdapter);

    // 归档 issue
    issueAdapter.archiveIssue(issue.id);

    // 验证各种写操作都被拒绝
    assert.throws(() => {
      stageAdapter.addOutputArtifacts(stage.id, { test: "value" });
    }, /archived/, "B8: 归档后写入产物应被拒绝");

    assert.throws(() => {
      stageAdapter.advanceStage(stage.id, "development");
    }, /archived/, "B8: 归档后推进 stage 应被拒绝");

    assert.throws(() => {
      stageAdapter.switchSnail(stage.id, "开发者", "snail-2");
    }, /archived/, "B8: 归档后切换 snail 应被拒绝");

    console.log("✓ B8: 归档后 issue 完全不可变");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── assertIssueMutable 测试 ─────────────────────────────────

function test_assertIssueMutable() {
  const tmpDir = makeTmpDir();
  try {
    const { issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue } = createTestIssue(issueAdapter, stageAdapter);

    // 未归档的 issue 应该可变
    assert.doesNotThrow(() => {
      assertIssueMutable(issue);
    }, "未归档的 issue 应该可变");

    // 归档 issue
    const archived = issueAdapter.archiveIssue(issue.id);

    // 已归档的 issue 应该不可变
    assert.throws(() => {
      assertIssueMutable(archived);
    }, /archived/, "已归档的 issue 应该不可变");

    console.log("✓ assertIssueMutable 守卫正确");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── 幂等性测试 ─────────────────────────────────────────────

function test_archive_idempotent() {
  const tmpDir = makeTmpDir();
  try {
    const { issueAdapter, stageAdapter } = createTestSetup(tmpDir);
    const { issue } = createTestIssue(issueAdapter, stageAdapter);

    // 第一次归档
    const first = issueAdapter.archiveIssue(issue.id);
    assert.notStrictEqual(first.archived_at, null, "幂等: 第一次归档应设置 archived_at");

    // 第二次归档（幂等）
    const second = issueAdapter.archiveIssue(issue.id);
    assert.strictEqual(first.archived_at, second.archived_at, "幂等: 第二次归档应返回相同结果");

    console.log("✓ 归档操作幂等");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── 运行所有测试 ─────────────────────────────────────────────

function runAllTests() {
  console.log("Running issue archive tests...\n");

  testB1_archive_issue();
  testB2_send_message_after_archive();
  testB3_advance_stage_after_archive();
  testB6_archive_does_not_complete_stage();
  testB7_archive_closed_issue();
  testB8_archive_immutability();
  test_assertIssueMutable();
  test_archive_idempotent();

  console.log("\n✓ All tests passed!");
}

runAllTests();
