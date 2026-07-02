import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { StagePort } from "@domain/issue/port";
import { Scope } from "@domain/workspace/model";
import type { MessagePort } from "@domain/message/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
import type { Issue, CloseSummary } from "@domain/issue/model";
import type { CleanupResult } from "@app/issue-collaboration/resource-cleanup";

vi.mock("@app/issue-collaboration/resource-cleanup", () => ({
  cleanupResources: vi.fn(),
}));

import { cleanupResources } from "@app/issue-collaboration/resource-cleanup";
const mockCleanupResources = vi.mocked(cleanupResources);

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Test Issue",
    summary: null,
    workspace_path: "/workspace",
    context: {},
    snail_assignment_plan: {},
    sop_snapshot: {
      key: "test-sop",
      name: "Test SOP",
      description: null,
      stage_definitions: [],
      transitions: [],
      shared_skill: null,
      scope: Scope.Platform,
    },
    created_at: "2026-01-01T00:00:00.000Z",
    closed_at: null,
    close_summary: null,
    ...overrides,
  };
}

function createMockIssuePort(issue: Issue) {
  return {
    findIssue: vi.fn().mockReturnValue(issue),
    listIssues: vi.fn(),
    previewSopStages: vi.fn(),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn().mockReturnValue({ ...issue, closed_at: "2026-01-02T00:00:00.000Z" }),
    updateCloseSummary: vi.fn(),
  };
}

function createMockStagePort(): StagePort {
  return {
    findStage: vi.fn(),
    listStages: vi.fn(),
    listOpenStageIds: vi.fn(),
    listAllOpenStageIds: vi.fn(),
    previewStage: vi.fn(),
    getStageSnailAssignmentPlan: vi.fn(),
    transaction: vi.fn((fn) => fn()),
    createStage: vi.fn(),
    addOutputArtifacts: vi.fn(),
    advanceStage: vi.fn(),
    rollbackStage: vi.fn(),
    recordAudit: vi.fn(),
    getAuditTrail: vi.fn(),
    switchSnail: vi.fn(),
    setSnailInstanceId: vi.fn(),
    getRoleSnailAssignments: vi.fn(),
    getRoleSnailAssignment: vi.fn(),
  };
}

function createMockMessagePort(): MessagePort {
  return {
    createMessage: vi.fn(),
    getMessage: vi.fn(),
    listMessages: vi.fn(),
    listMessagesWindow: vi.fn(),
    searchContext: vi.fn(),
    listMessagesByStatus: vi.fn(),
    updateMessageTargets: vi.fn(),
    completeMessage: vi.fn(),
    appendEvent: vi.fn(),
    getMessageEvents: vi.fn(),
    getContext: vi.fn(),
    setContext: vi.fn(),
    getCursor: vi.fn(),
    advanceCursor: vi.fn(),
    getUnreadMessages: vi.fn(),
    initCursor: vi.fn(),
    findLatestRespondingSpeaker: vi.fn(),
    findLatestMessage: vi.fn(),
  };
}

function createMockSnailPort(): SnailPort {
  return { list: vi.fn(), findByKey: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), invokeFirstCall: vi.fn(), invokeResume: vi.fn() };
}

function createMockLiteAIPort(): LiteAIPort {
  return { getConfig: vi.fn(), chat: vi.fn() };
}

function createMockMcpMessageStore(): McpMessageStore {
  return { getMcpRoutingTargets: vi.fn(), setMcpRoutingTargets: vi.fn(), deleteMcpRoutingTargets: vi.fn() };
}

function createMockStageSuggestionRepo(): StageSuggestionRepository {
  return {
    insert: vi.fn(),
    listPendingByStage: vi.fn().mockReturnValue([]),
    countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0),
    markProcessed: vi.fn(),
    deleteByStage: vi.fn(),
  };
}

/** 从 mock 调用记录中提取 updateCloseSummary 的第一个参数（CloseSummary） */
function getCapturedSummary(issuePort: { updateCloseSummary: ReturnType<typeof vi.fn> }): CloseSummary | null {
  const calls = issuePort.updateCloseSummary.mock.calls;
  return calls.length > 0 ? (calls[0][1] as CloseSummary) : null;
}

describe("closeIssue activity recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** B1: 关闭 Issue 时应设置 close_summary（cleanup 异步执行） */
  it("B1: 关闭 Issue 时记录清理结果到 close_summary", async () => {
    const issue = createIssue();
    const issuePort = createMockIssuePort(issue);
    const cleanupResult: CleanupResult = {
      pr: { status: "success" },
      worktree: { status: "success" },
      localBranch: { status: "success" },
      remoteBranch: { status: "success" },
    };
    mockCleanupResources.mockResolvedValue(cleanupResult);

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    const result = await collaboration.closeIssue("issue-1");
    // API 立即返回 pending 状态
    expect(result.cleanup.pr.status).toBe("pending");
    // 等待异步 cleanup 完成
    await vi.waitFor(() => expect(issuePort.updateCloseSummary).toHaveBeenCalled());
    const summary = getCapturedSummary(issuePort);
    expect(summary).toEqual(cleanupResult);
  });

  /** B2: 幂等处理，重复关闭不覆盖 close_summary */
  it("B2: 已关闭的 Issue 重复关闭时不覆盖 close_summary", async () => {
    const existingSummary = {
      pr: { status: "success" as const },
      worktree: { status: "success" as const },
      localBranch: { status: "success" as const },
      remoteBranch: { status: "success" as const },
    };
    const issue = createIssue({
      closed_at: "2026-01-02T00:00:00.000Z",
      close_summary: existingSummary,
    });
    const issuePort = createMockIssuePort(issue);
    // closeIssue 在幂等分支直接返回已关闭的 issue
    issuePort.closeIssue.mockReturnValue(issue);

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    const result = await collaboration.closeIssue("issue-1");

    // 幂等分支不执行 cleanup，因此 updateCloseSummary 不应被调用
    expect(issuePort.updateCloseSummary).not.toHaveBeenCalled();
    // 返回的 issue 保留原有 close_summary
    expect(result.issue.close_summary).toEqual(existingSummary);
  });

  /** B3: 全部成功时 close_summary 包含每个资源的 success 状态 */
  it("B3: 资源清理全部成功时 close_summary 记录 success", async () => {
    const issue = createIssue({ context: { pr_url: "https://github.com/x/y/pull/1", worktree_path: "/workspace/.snail/worktrees/wt", branch_name: "feature-x" } });
    const issuePort = createMockIssuePort(issue);
    mockCleanupResources.mockResolvedValue({
      pr: { status: "success" },
      worktree: { status: "success" },
      localBranch: { status: "success" },
      remoteBranch: { status: "success" },
    });

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collaboration.closeIssue("issue-1");
    await vi.waitFor(() => expect(issuePort.updateCloseSummary).toHaveBeenCalled());

    const summary = getCapturedSummary(issuePort)!;
    expect(summary.pr.status).toBe("success");
    expect(summary.worktree.status).toBe("success");
    expect(summary.localBranch.status).toBe("success");
    expect(summary.remoteBranch.status).toBe("success");
  });

  /** B4: 部分资源清理失败时 close_summary 包含失败项的 error 信息 */
  it("B4: 部分资源清理失败时 close_summary 记录 error", async () => {
    const issue = createIssue({ context: { branch_name: "feature-x" } });
    const issuePort = createMockIssuePort(issue);
    mockCleanupResources.mockResolvedValue({
      pr: { status: "skipped" },
      worktree: { status: "skipped" },
      localBranch: { status: "failed", error: "分支未合入，请手动处理" },
      remoteBranch: { status: "success" },
    });

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collaboration.closeIssue("issue-1");
    await vi.waitFor(() => expect(issuePort.updateCloseSummary).toHaveBeenCalled());

    const summary = getCapturedSummary(issuePort)!;
    expect(summary.localBranch.status).toBe("failed");
    expect(summary.localBranch.error).toBe("分支未合入，请手动处理");
  });

  /** B5: 无关联资源时全部 skipped */
  it("B5: 无关联资源时 close_summary 记录所有资源为 skipped", async () => {
    const issue = createIssue();
    const issuePort = createMockIssuePort(issue);
    mockCleanupResources.mockResolvedValue({
      pr: { status: "skipped" },
      worktree: { status: "skipped" },
      localBranch: { status: "skipped" },
      remoteBranch: { status: "skipped" },
    });

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collaboration.closeIssue("issue-1");
    await vi.waitFor(() => expect(issuePort.updateCloseSummary).toHaveBeenCalled());

    const summary = getCapturedSummary(issuePort)!;
    expect(summary.pr.status).toBe("skipped");
    expect(summary.worktree.status).toBe("skipped");
    expect(summary.localBranch.status).toBe("skipped");
    expect(summary.remoteBranch.status).toBe("skipped");
  });

  /** B6: updateCloseSummary 失败时不阻断 close 流程 */
  it("B6: updateCloseSummary 失败时不阻断 close 流程", async () => {
    const issue = createIssue();
    const issuePort = createMockIssuePort(issue);
    issuePort.updateCloseSummary.mockImplementation(() => {
      throw new Error("DB write failed");
    });
    mockCleanupResources.mockResolvedValue({
      pr: { status: "skipped" },
      worktree: { status: "skipped" },
      localBranch: { status: "skipped" },
      remoteBranch: { status: "skipped" },
    });

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    const result = await collaboration.closeIssue("issue-1");
    // API 立即返回，不阻塞
    expect(result.issue.closed_at).toBeTruthy();
    expect(result.cleanup).toBeDefined();
    // 异步 cleanup 中 updateCloseSummary 失败不应抛出
    await vi.waitFor(() => expect(mockCleanupResources).toHaveBeenCalled());
  });
});
