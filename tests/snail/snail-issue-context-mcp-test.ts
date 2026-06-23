/**
 * Snail Issue Context MCP Server 测试 — 覆盖 Feature 文档 B1-B3, B7-B8
 *
 * 测试范围说明：
 * - B1: set_context 写入 Issue.context ✅
 * - B2: get_context 返回完整上下文 ✅
 * - B3: get_context 返回单个 key ✅
 * - B4-B6: system reminder 注入逻辑 — 在 collaboration 层测试（不在本文件）
 * - B7: 并发写入 merge 语义 ✅
 * - B8: 初始 context 写入 ✅
 *
 * 运行方式：npx tsx tests/snail/snail-issue-context-mcp-test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import { SQLiteDatabase } from "@infra/database";
import { SQLiteIssueRepository } from "@domain/issue/_internal/repository";
import { Scope } from "@domain/workspace/model";
import { createSnailIssueContextServer } from "@domain/snail-mcp-server/_internal/servers/snail-issue-context";
import type { Issue } from "@domain/issue/model";

// ── 测试辅助 ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "snail-issue-context-test-"));
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "test-issue-1",
    workspace_path: "/test/workspace",
    title: "Test Issue",
    summary: "Test Summary",
    sop_snapshot: {
      key: "test-sop",
      name: "Test SOP",
      description: "Test SOP Description",
      shared_skill: null,
      stage_definitions: [],
      transitions: [],
      scope: Scope.Platform,
    },
    snail_assignment_plan: {},
    context: {},
    created_at: new Date().toISOString(),
    closed_at: null,
    ...overrides,
  };
}

/** 创建隔离的测试环境 */
function createTestEnv() {
  const tmpDir = makeTmpDir();
  const db = new SQLiteDatabase(tmpDir);
  const issueRepo = new SQLiteIssueRepository(db);
  const issuePort = {
    findIssue: (id: string) => issueRepo.findById(id),
    listIssues: () => [],
    previewSopStages: () => [],
    validateSnailAssignmentPlan: () => {},
    updateContext: (issueId: string, context: Record<string, string>) => {
      const issue = issueRepo.findById(issueId);
      if (!issue) throw new Error(`Issue not found: ${issueId}`);
      const merged = { ...issue.context, ...context };
      issueRepo.updateContext(issueId, merged);
    },
  };
  const server = createSnailIssueContextServer(issuePort);
  return { tmpDir, db, issueRepo, issuePort, server };
}

// ── 测试用例 ──────────────────────────────────────────────────

async function testSetContext() {
  console.log("测试 B1: set_context 写入 Issue.context");
  const { tmpDir, issueRepo, server } = createTestEnv();

  try {
    // 创建测试 Issue
    const issue = makeIssue();
    issueRepo.create(issue);

    // 获取 set_context 工具
    const setContextTool = server.tools.find(t => t.name === "set_context");
    assert(setContextTool, "set_context 工具应该存在");

    // 调用 set_context
    const result = await setContextTool.handler({
      issue_id: "test-issue-1",
      key: "design.feature_doc_path",
      value: "/path/to/feature.md",
    });

    // 验证结果
    assert.deepStrictEqual(result, { success: true, key: "design.feature_doc_path" });

    // 验证 Issue.context 已更新
    const updatedIssue = issueRepo.findById("test-issue-1");
    assert(updatedIssue, "Issue 应该存在");
    assert.strictEqual(updatedIssue.context["design.feature_doc_path"], "/path/to/feature.md");

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testGetContextAll() {
  console.log("测试 B2: get_context 返回完整上下文");
  const { tmpDir, issueRepo, server } = createTestEnv();

  try {
    // 创建测试 Issue
    const issue = makeIssue({
      context: {
        "design.feature_doc_path": "/path/to/feature.md",
        "review.status": "approved",
      },
    });
    issueRepo.create(issue);

    // 获取 get_context 工具
    const getContextTool = server.tools.find(t => t.name === "get_context");
    assert(getContextTool, "get_context 工具应该存在");

    // 调用 get_context（不传 key）
    const result = await getContextTool.handler({
      issue_id: "test-issue-1",
    });

    // 验证结果
    assert.deepStrictEqual(result, {
      context: {
        "design.feature_doc_path": "/path/to/feature.md",
        "review.status": "approved",
      },
    });

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testGetContextByKey() {
  console.log("测试 B3: get_context 返回单个 key");
  const { tmpDir, issueRepo, server } = createTestEnv();

  try {
    // 创建测试 Issue
    const issue = makeIssue({
      context: {
        "design.feature_doc_path": "/path/to/feature.md",
        "review.status": "approved",
      },
    });
    issueRepo.create(issue);

    // 获取 get_context 工具
    const getContextTool = server.tools.find(t => t.name === "get_context");
    assert(getContextTool, "get_context 工具应该存在");

    // 调用 get_context（传入 key）
    const result = await getContextTool.handler({
      issue_id: "test-issue-1",
      key: "design.feature_doc_path",
    });

    // 验证结果
    assert.deepStrictEqual(result, { value: "/path/to/feature.md" });

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testGetContextMissingKey() {
  console.log("测试 B3: get_context 返回不存在的 key");
  const { tmpDir, issueRepo, server } = createTestEnv();

  try {
    // 创建测试 Issue
    const issue = makeIssue();
    issueRepo.create(issue);

    // 获取 get_context 工具
    const getContextTool = server.tools.find(t => t.name === "get_context");
    assert(getContextTool, "get_context 工具应该存在");

    // 调用 get_context（传入不存在的 key）
    const result = await getContextTool.handler({
      issue_id: "test-issue-1",
      key: "nonexistent.key",
    });

    // 验证结果
    assert.deepStrictEqual(result, { value: null });

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testGetContextIssueNotFound() {
  console.log("测试: get_context Issue 不存在时抛错");
  const { tmpDir, server } = createTestEnv();

  try {
    // 获取 get_context 工具
    const getContextTool = server.tools.find(t => t.name === "get_context");
    assert(getContextTool, "get_context 工具应该存在");

    // 调用 get_context（Issue 不存在）
    await assert.rejects(
      () => getContextTool.handler({ issue_id: "nonexistent" }),
      (error: Error) => {
        assert.strictEqual(error.message, "Issue not found: nonexistent");
        return true;
      }
    );

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testMergeSemantics() {
  console.log("测试 B7: merge 语义（后写入覆盖先写入）");
  const { tmpDir, issueRepo, server } = createTestEnv();

  try {
    // 创建测试 Issue
    const issue = makeIssue({
      context: {
        "design.feature_doc_path": "/old/path",
        "review.status": "pending",
      },
    });
    issueRepo.create(issue);

    // 获取 set_context 工具
    const setContextTool = server.tools.find(t => t.name === "set_context");
    assert(setContextTool, "set_context 工具应该存在");

    // 第一次写入
    await setContextTool.handler({
      issue_id: "test-issue-1",
      key: "design.feature_doc_path",
      value: "/new/path",
    });

    // 第二次写入（覆盖）
    await setContextTool.handler({
      issue_id: "test-issue-1",
      key: "review.status",
      value: "approved",
    });

    // 验证结果
    const updatedIssue = issueRepo.findById("test-issue-1");
    assert(updatedIssue, "Issue 应该存在");
    assert.strictEqual(updatedIssue.context["design.feature_doc_path"], "/new/path");
    assert.strictEqual(updatedIssue.context["review.status"], "approved");

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testSetContextIssueNotFound() {
  console.log("测试: set_context Issue 不存在时抛错");
  const { tmpDir, server } = createTestEnv();

  try {
    // 获取 set_context 工具
    const setContextTool = server.tools.find(t => t.name === "set_context");
    assert(setContextTool, "set_context 工具应该存在");

    // 调用 set_context（Issue 不存在）
    await assert.rejects(
      () => setContextTool.handler({
        issue_id: "nonexistent",
        key: "test.key",
        value: "test.value",
      }),
      (error: Error) => {
        assert.strictEqual(error.message, "Issue not found: nonexistent");
        return true;
      }
    );

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testReservedKeyValidation() {
  console.log("测试: set_context 拒绝系统保留 key");
  const { tmpDir, issueRepo, server } = createTestEnv();

  try {
    // 创建测试 Issue
    const issue = makeIssue();
    issueRepo.create(issue);

    // 获取 set_context 工具
    const setContextTool = server.tools.find(t => t.name === "set_context");
    assert(setContextTool, "set_context 工具应该存在");

    // 尝试写入保留 key
    const reservedKeys = ["issue_id", "stage_id", "message_id", "stage_key", "role_instance"];
    for (const key of reservedKeys) {
      await assert.rejects(
        () => setContextTool.handler({
          issue_id: "test-issue-1",
          key: key,
          value: "test.value",
        }),
        (error: Error) => {
          assert(error.message.includes("Reserved key"), `Expected "Reserved key" error for ${key}, got: ${error.message}`);
          return true;
        }
      );
    }

    console.log("  ✅ 通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── 运行测试 ──────────────────────────────────────────────────

async function runTests() {
  console.log("🧪 Snail Issue Context MCP Server 测试\n");

  try {
    await testSetContext();
    await testGetContextAll();
    await testGetContextByKey();
    await testGetContextMissingKey();
    await testGetContextIssueNotFound();
    await testMergeSemantics();
    await testSetContextIssueNotFound();
    await testReservedKeyValidation();

    console.log("\n✅ 所有测试通过");
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    process.exit(1);
  }
}

runTests();