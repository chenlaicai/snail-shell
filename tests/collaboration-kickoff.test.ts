import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage, Issue } from "@domain/issue/model";
import { Scope } from "@domain/workspace/model";

function createMockMessagePort(overrides: Partial<MessagePort> = {}): MessagePort {
  return {
    createMessage: () => ({ id: 1, stage_id: "s1", from_speaker: null, to_speakers: [], status: "streaming", created_at: "", ended_at: null }),
    getMessage: () => undefined,
    listMessages: () => [],
    listMessagesWindow: () => [],
    searchContext: () => [],
    listMessagesByStatus: () => [],
    updateMessageTargets: () => {},
    completeMessage: () => {},
    appendEvent: () => ({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
    getMessageEvents: () => [],
    getContext: () => null,
    setContext: () => {},
    getCursor: () => 0,
    advanceCursor: () => {},
    getUnreadMessages: () => [],
    initCursor: () => {},
    findLatestRespondingSpeaker: () => null,
    findLatestMessage: () => undefined,
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

function createMockSnailPort(): SnailPort {
  return {
    list: vi.fn(),
    findByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    invokeFirstCall: vi.fn(),
    invokeResume: vi.fn(),
  };
}

function createMockLiteAIPort(): LiteAIPort {
  return {
    getConfig: vi.fn(),
    chat: vi.fn(),
  };
}

function createNewStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "s2",
    workspace_path: "/workspace",
    issue_id: "issue-1",
    key: "development",
    title: "Development",
    description: "",
    default_role_instance: "developer",
    role_instances: ["developer"],
    from_stage_id: "s1",
    available_transitions: [],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

function createOpenIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    workspace_path: "/workspace",
    title: "Test Issue",
    summary: null,
    sop_snapshot: { key: "test", name: "Test SOP", description: null, shared_skill: null, stage_definitions: [], transitions: [], scope: Scope.Workspace },
    snail_assignment_plan: {},
    context: {},
    created_at: new Date().toISOString(),
    closed_at: null,
    close_summary: null,
    ...overrides,
  };
}

describe("autoInvokeNewStage: advanceStage/rollbackStage 后自动发送 kickoff 消息", () => {
  let createMessageSpy: ReturnType<typeof vi.fn>;
  let setContextSpy: ReturnType<typeof vi.fn>;
  let appendEventSpy: ReturnType<typeof vi.fn>;
  let completeMessageSpy: ReturnType<typeof vi.fn>;
  let nextMessageId: number;

  beforeEach(() => {
    nextMessageId = 1;
    createMessageSpy = vi.fn().mockImplementation(() => {
      const id = nextMessageId++;
      return { id, stage_id: "s2", from_speaker: "", to_speakers: [], status: "completed", created_at: "", ended_at: null };
    });
    setContextSpy = vi.fn();
    appendEventSpy = vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "开始执行。" }, created_at: "" });
    completeMessageSpy = vi.fn();
  });

  function createCollaboration(opts: { issuePort?: IssuePort; stagePort?: StagePort; messagePort?: MessagePort } = {}) {
    const newStage = createNewStage();
    const messagePort = opts.messagePort ?? createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
      setContext: setContextSpy as unknown as MessagePort["setContext"],
      appendEvent: appendEventSpy as unknown as MessagePort["appendEvent"],
      completeMessage: completeMessageSpy as unknown as MessagePort["completeMessage"],
      getMessage: (id) => ({ id, stage_id: newStage.id, from_speaker: "", to_speakers: [], status: "completed", created_at: "", ended_at: null }),
    });
    const issuePort = opts.issuePort ?? createMockIssuePort({
      findIssue: vi.fn().mockReturnValue(createOpenIssue()),
    });
    const stagePort = opts.stagePort ?? createMockStagePort({
      findStage: vi.fn().mockReturnValue(newStage),
      advanceStage: vi.fn().mockReturnValue(newStage),
      rollbackStage: vi.fn().mockReturnValue(newStage),
    });

    return new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });
  }

  it("advanceStage 后自动发送 kickoff 消息", async () => {
    const collaboration = createCollaboration();

    await collaboration.advanceStage("s1", "development");

    expect(createMessageSpy).toHaveBeenCalled();
  });

  it("kickoff 消息设置 final_text context", async () => {
    const collaboration = createCollaboration();

    await collaboration.advanceStage("s1", "development");

    expect(setContextSpy).toHaveBeenCalled();
  });

  it("kickoff 消息创建 text event（S1：确保 UI 可渲染）", async () => {
    const collaboration = createCollaboration();

    await collaboration.advanceStage("s1", "development");

    expect(appendEventSpy).toHaveBeenCalled();
  });

  it("kickoff 消息标记为 completed", async () => {
    const collaboration = createCollaboration();

    await collaboration.advanceStage("s1", "development");

    expect(completeMessageSpy).toHaveBeenCalled();
  });

  it("rollbackStage 后也自动发送 kickoff 消息", async () => {
    const collaboration = createCollaboration();

    await collaboration.rollbackStage("s2", "design");

    expect(createMessageSpy).toHaveBeenCalled();
    expect(appendEventSpy).toHaveBeenCalled();
  });

  it("无 default_role_instance 时不发送消息", async () => {
    const stagePort = createMockStagePort({
      findStage: vi.fn().mockReturnValue(createNewStage({ default_role_instance: "" })),
      advanceStage: vi.fn().mockReturnValue(createNewStage({ default_role_instance: "" })),
    });
    const collaboration = createCollaboration({ stagePort });

    await collaboration.advanceStage("s1", "development");

    expect(createMessageSpy).not.toHaveBeenCalled();
  });

  it("issue 已关闭时不发送消息（不抛异常）", async () => {
    const issuePort = createMockIssuePort({
      findIssue: vi.fn().mockReturnValue(createOpenIssue({ closed_at: new Date().toISOString() })),
    });
    const collaboration = createCollaboration({ issuePort });

    await expect(collaboration.advanceStage("s1", "development")).resolves.toBeDefined();
    expect(createMessageSpy).not.toHaveBeenCalled();
  });
});
