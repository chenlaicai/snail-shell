import { describe, it, expect, vi } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage, Issue, CreateIssueInput } from "@domain/issue/model";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
import { Scope } from "@domain/workspace/model";

function createMockMessagePort(overrides: Partial<MessagePort> = {}): MessagePort {
  return {
    createMessage: vi.fn(),
    getMessage: () => undefined,
    listMessages: () => [],
    listMessagesWindow: () => [],
    searchContext: () => [],
    searchByFts: () => [],
    listMessagesByStatus: () => [],
    updateMessageTargets: () => {},
    completeMessage: () => {},
    appendEvent: vi.fn(),
    getMessageEvents: () => [],
    getContext: () => null,
    setContext: () => {},
    getCursor: () => 0,
    advanceCursor: () => {},
    getUnreadMessages: () => [],
    initCursor: () => {},
    findLatestRespondingSpeaker: () => null,
    findLatestMessage: () => undefined,
    findLatestMessageBySpeaker: () => undefined,
    findLatestMessageByIssueId: () => undefined,
    ...overrides,
  };
}

function createMockMcpMessageStore(): McpMessageStore {
  return {
    getMcpRoutingTargets: () => undefined,
    setMcpRoutingTargets: () => {},
    deleteMcpRoutingTargets: () => {},
  };
}

function createMockStageSuggestionRepo(): StageSuggestionRepository {
  return { insert: vi.fn(), listPendingByStage: vi.fn().mockReturnValue([]), listActiveByStage: vi.fn().mockReturnValue([]), countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0), markSeen: vi.fn(), markProcessed: vi.fn(), deleteByStage: vi.fn() };
}

function createMockIssuePort(overrides: Partial<IssuePort> = {}): IssuePort {
  return {
    findIssue: vi.fn(),
    listIssues: vi.fn(),
    previewSopStages: vi.fn(),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn(),
    updateCloseSummary: vi.fn(),
    ...overrides,
  };
}

function createMockStagePort(overrides: Partial<StagePort> = {}): StagePort {
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
    ...overrides,
  };
}

function createMockSnailPort(overrides: Partial<SnailPort> = {}): SnailPort {
  return {
    list: vi.fn(),
    findByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    invokeFirstCall: vi.fn(),
    invokeResume: vi.fn(),
    ...overrides,
  };
}

function createMockLiteAIPort(): LiteAIPort {
  return {
    getConfig: vi.fn(),
    chat: vi.fn(),
  };
}

function createStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "s1",
    workspace_path: "/workspace",
    issue_id: "issue-1",
    key: "design",
    title: "Design",
    description: "",
    default_role_instance: "architect-1",
    role_instances: ["architect-1"],
    from_stage_id: null,
    available_transitions: [],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    workspace_path: "/workspace",
    title: "Test Issue",
    summary: null,
    sop_snapshot: { key: "test", name: "Test SOP", description: null, shared_skill: null, stage_definitions: [{ key: "design", title: "Design", description: "", roles: [] }], transitions: [], scope: Scope.Workspace },
    snail_assignment_plan: {},
    context: {},
    created_at: new Date().toISOString(),
    closed_at: null,
    close_summary: null,
    ...overrides,
  };
}

describe("spawnIssue", () => {
  let createIssueSpy: ReturnType<typeof vi.fn>;

  function createCollaboration(opts: {
    issuePort?: Partial<IssuePort>;
    snailPort?: Partial<SnailPort>;
  } = {}) {
    const issue = createIssue();
    const stage = createStage();
    createIssueSpy = vi.fn().mockReturnValue(issue);

    const issuePort = createMockIssuePort({
      previewSopStages: vi.fn().mockReturnValue([
        { key: "design", title: "Design", description: "", role_instances: [{ role_instance: "architect-1", role_key: "architect" }] },
      ]),
      findIssue: vi.fn().mockReturnValue(issue),
      ...opts.issuePort,
    });
    const snailPort = createMockSnailPort({
      list: vi.fn().mockReturnValue([{ key: "snail-1" }]),
      ...opts.snailPort,
    });
    const stagePort = createMockStagePort({
      createStage: vi.fn().mockReturnValue(stage),
      findStage: vi.fn().mockReturnValue(stage),
      getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "snail-1", snail_instance_id: null, role_key: "architect" }),
    });

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: createIssueSpy as unknown as (input: CreateIssueInput) => Issue,
      stagePort,
      messagePort: createMockMessagePort(),
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    return { collaboration, issue, stage };
  }

  it("B1: 全参数调用 — 创建 Issue 并写入 source_issue_id 到 context", async () => {
    const { collaboration } = createCollaboration();

    const result = await collaboration.spawnIssue({
      workspace_path: "/workspace",
      title: "New Issue",
      summary: "继承前序 Issue 的上下文",
      adopted_sop_key: "code-delivery",
      source_issue_id: "issue-1",
    });

    expect(result.issue).toBeDefined();
    expect(result.stage).toBeDefined();
    expect(createIssueSpy).toHaveBeenCalled();
    const callArg = createIssueSpy.mock.calls[0][0];
    expect(callArg.workspace_path).toBe("/workspace");
    expect(callArg.title).toBe("New Issue");
    expect(callArg.summary).toBe("继承前序 Issue 的上下文");
    expect(callArg.adopted_sop_key).toBe("code-delivery");
    expect(callArg.context).toEqual({ source_issue_id: "issue-1" });
    /** source_issue_id 已消费到 context，不应泄漏到 CreateIssueInput */
    expect(callArg.source_issue_id).toBeUndefined();
    /** snail_assignment_plan 自动分配 snail-1 给所有 role instance */
    expect(callArg.snail_assignment_plan).toEqual({ design: { "architect-1": "snail-1" } });
  });

  it("B3: source_issue_id 不存在时抛错", async () => {
    const { collaboration } = createCollaboration({
      issuePort: { findIssue: vi.fn().mockReturnValue(undefined) },
    });

    await expect(collaboration.spawnIssue({
      workspace_path: "/workspace",
      title: "New Issue",
      adopted_sop_key: "code-delivery",
      source_issue_id: "nonexistent",
    })).rejects.toThrow("Source issue not found: nonexistent");

    expect(createIssueSpy).not.toHaveBeenCalled();
  });

  it("B3: source_issue_id workspace 不匹配时抛错", async () => {
    const { collaboration } = createCollaboration({
      issuePort: {
        findIssue: vi.fn().mockReturnValue(createIssue({ workspace_path: "/other-workspace" })),
      },
    });

    await expect(collaboration.spawnIssue({
      workspace_path: "/workspace",
      title: "New Issue",
      adopted_sop_key: "code-delivery",
      source_issue_id: "issue-1",
    })).rejects.toThrow("Source issue workspace mismatch");

    expect(createIssueSpy).not.toHaveBeenCalled();
  });

  it("B4: 不传 source_issue_id — 创建独立 Issue，context 为空", async () => {
    const { collaboration } = createCollaboration();

    const result = await collaboration.spawnIssue({
      workspace_path: "/workspace",
      title: "Independent Issue",
      adopted_sop_key: "general-assistant",
    });

    expect(result.issue).toBeDefined();
    const callArg = createIssueSpy.mock.calls[0][0];
    expect(callArg.context).toEqual({});
  });

  it("B5: 不传 summary — summary 为 undefined", async () => {
    const { collaboration } = createCollaboration();

    await collaboration.spawnIssue({
      workspace_path: "/workspace",
      title: "No Summary Issue",
      adopted_sop_key: "general-assistant",
    });

    const callArg = createIssueSpy.mock.calls[0][0];
    expect(callArg.summary).toBeUndefined();
  });

  it("B7: 无可用 snail 时抛错", async () => {
    const { collaboration } = createCollaboration({
      snailPort: { list: vi.fn().mockReturnValue([]) },
    });

    await expect(collaboration.spawnIssue({
      workspace_path: "/workspace",
      title: "New Issue",
      adopted_sop_key: "code-delivery",
    })).rejects.toThrow("No snail available in the den");

    expect(createIssueSpy).not.toHaveBeenCalled();
  });

  it("为多个 stage 的多个 role instance 自动分配 snail", async () => {
    const { collaboration } = createCollaboration({
      issuePort: {
        previewSopStages: vi.fn().mockReturnValue([
          { key: "design", title: "Design", description: "", role_instances: [{ role_instance: "architect-1", role_key: "architect" }] },
          { key: "development", title: "Development", description: "", role_instances: [{ role_instance: "developer", role_key: "developer" }, { role_instance: "reviewer-1", role_key: "reviewer" }] },
        ]),
        findIssue: vi.fn().mockReturnValue(createIssue()),
      },
    });

    await collaboration.spawnIssue({
      workspace_path: "/workspace",
      title: "Multi-Stage Issue",
      adopted_sop_key: "code-delivery",
    });

    const callArg = createIssueSpy.mock.calls[0][0];
    expect(callArg.snail_assignment_plan).toEqual({
      design: { "architect-1": "snail-1" },
      development: { developer: "snail-1", "reviewer-1": "snail-1" },
    });
  });
});
