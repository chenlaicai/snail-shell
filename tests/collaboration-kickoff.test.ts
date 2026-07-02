import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage, Issue } from "@domain/issue/model";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
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

function createMockStageSuggestionRepo(): StageSuggestionRepository {
  return { insert: vi.fn(), listPendingByStage: vi.fn().mockReturnValue([]), countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0), markProcessed: vi.fn(), deleteByStage: vi.fn() };
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
    transferStage: vi.fn(),
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
    status: "active",
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
  let invokeFirstCallSpy: ReturnType<typeof vi.fn>;
  let nextMessageId: number;
  let messageStore: Map<number, { id: number; stage_id: string; from_speaker: string; to_speakers: string[]; status: "completed" | "streaming" | "failed"; created_at: string; ended_at: null }>;

  beforeEach(() => {
    nextMessageId = 100; // start high to avoid collision with seeded messages
    messageStore = new Map();
    // Seed with a user message so dispatch finds unread messages
    messageStore.set(1, { id: 1, stage_id: "s2", from_speaker: "user", to_speakers: [], status: "completed" as const, created_at: "", ended_at: null });
    createMessageSpy = vi.fn().mockImplementation((input: { stage_id: string; from_speaker: string; to_speakers: string[]; status: "completed" | "streaming" | "failed" }) => {
      const id = nextMessageId++;
      const msg = { id, ...input, created_at: "", ended_at: null };
      messageStore.set(id, msg);
      return msg;
    });
    setContextSpy = vi.fn();
    appendEventSpy = vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "开始执行。" }, created_at: "" });
    completeMessageSpy = vi.fn();
    invokeFirstCallSpy = vi.fn().mockResolvedValue({ snail_instance_id: "test-instance" });
  });

  function createCollaboration(opts: { issuePort?: IssuePort; stagePort?: StagePort; messagePort?: MessagePort; snailPort?: SnailPort } = {}) {
    const newStage = createNewStage();
    const messagePort = opts.messagePort ?? createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
      setContext: setContextSpy as unknown as MessagePort["setContext"],
      appendEvent: appendEventSpy as unknown as MessagePort["appendEvent"],
      completeMessage: completeMessageSpy as unknown as MessagePort["completeMessage"],
      getMessage: (id) => messageStore.get(id),
      updateMessageTargets: vi.fn((id: number, toSpeakers: string[]) => {
        const msg = messageStore.get(id);
        if (msg) msg.to_speakers = toSpeakers;
      }) as unknown as MessagePort["updateMessageTargets"],
      getUnreadMessages: () => {
        const unread = [];
        for (const msg of messageStore.values()) {
          if (msg.from_speaker === "user" && msg.status === "completed") unread.push(msg);
        }
        return unread;
      },
    });
    const issuePort = opts.issuePort ?? createMockIssuePort({
      findIssue: vi.fn().mockReturnValue(createOpenIssue()),
    });
    const stagePort = opts.stagePort ?? createMockStagePort({
      findStage: vi.fn().mockReturnValue(newStage),
      advanceStage: vi.fn().mockReturnValue(newStage),
      rollbackStage: vi.fn().mockReturnValue(newStage),
      getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: null, role_key: "developer" }),
    });
    const snailPort = opts.snailPort ?? {
      ...createMockSnailPort(),
      invokeFirstCall: invokeFirstCallSpy as unknown as SnailPort["invokeFirstCall"],
    };

    return new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });
  }

  it("advanceStage 后自动发送 kickoff 消息并触发 agent", async () => {
    const collaboration = createCollaboration();

    await collaboration.advanceStage("s1", "development");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(createMessageSpy).toHaveBeenCalled();
    /** kickoff 消息参数：系统消息（from_speaker=""） */
    const kickoffCall = createMessageSpy.mock.calls[0][0];
    expect(kickoffCall.stage_id).toBe("s2");
    expect(kickoffCall.from_speaker).toBe("");
    expect(kickoffCall.status).toBe("completed");
    expect(invokeFirstCallSpy).toHaveBeenCalled();
  });

  it("kickoff 消息设置 final_text context", async () => {
    const collaboration = createCollaboration();

    await collaboration.advanceStage("s1", "development");

    expect(setContextSpy).toHaveBeenCalled();
    /** setContext 参数：messageId, "final_text", "开始执行。" */
    const contextCall = setContextSpy.mock.calls[0];
    expect(contextCall[1]).toBe("final_text");
    expect(contextCall[2]).toBe("开始执行。");
  });

  it("kickoff 消息创建 text event（S1：确保 UI 可渲染）", async () => {
    const collaboration = createCollaboration();

    await collaboration.advanceStage("s1", "development");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(appendEventSpy).toHaveBeenCalled();
    /** appendEvent 参数：messageId, { type: "text", text: "开始执行。" } */
    const eventCall = appendEventSpy.mock.calls[0];
    expect(eventCall[1]).toEqual({ type: "text", text: "开始执行。" });
  });

  it("rollbackStage 后也自动发送 kickoff 消息并触发 agent", async () => {
    const collaboration = createCollaboration();

    await collaboration.rollbackStage("s2", "design");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(createMessageSpy).toHaveBeenCalled();
    expect(invokeFirstCallSpy).toHaveBeenCalled();
  });

  it("无 default_role_instance 时不发送消息", async () => {
    const stagePort = createMockStagePort({
      findStage: vi.fn().mockReturnValue(createNewStage({ default_role_instance: "" })),
      advanceStage: vi.fn().mockReturnValue(createNewStage({ default_role_instance: "" })),
    });
    const collaboration = createCollaboration({ stagePort });

    await collaboration.advanceStage("s1", "development");

    expect(createMessageSpy).not.toHaveBeenCalled();
    expect(invokeFirstCallSpy).not.toHaveBeenCalled();
  });

  it("issue 已关闭时不发送消息（不抛异常）", async () => {
    const issuePort = createMockIssuePort({
      findIssue: vi.fn().mockReturnValue(createOpenIssue({ closed_at: new Date().toISOString() })),
    });
    const collaboration = createCollaboration({ issuePort });

    await expect(collaboration.advanceStage("s1", "development")).resolves.toBeDefined();
    expect(createMessageSpy).not.toHaveBeenCalled();
    expect(invokeFirstCallSpy).not.toHaveBeenCalled();
  });
});

describe("autoInvokeFirstStage: createIssue 后自动发送 kickoff 消息", () => {
  let createMessageSpy: ReturnType<typeof vi.fn>;
  let setContextSpy: ReturnType<typeof vi.fn>;
  let appendEventSpy: ReturnType<typeof vi.fn>;
  let invokeFirstCallSpy: ReturnType<typeof vi.fn>;
  let nextMessageId: number;
  let messageStore: Map<number, { id: number; stage_id: string; from_speaker: string; to_speakers: string[]; status: "completed" | "streaming" | "failed"; created_at: string; ended_at: null }>;

  beforeEach(() => {
    nextMessageId = 100;
    messageStore = new Map();
    createMessageSpy = vi.fn().mockImplementation((input: { stage_id: string; from_speaker: string; to_speakers: string[]; status: "completed" | "streaming" | "failed" }) => {
      const id = nextMessageId++;
      const msg = { id, ...input, created_at: "", ended_at: null };
      messageStore.set(id, msg);
      return msg;
    });
    setContextSpy = vi.fn();
    appendEventSpy = vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" });
    invokeFirstCallSpy = vi.fn().mockResolvedValue({ snail_instance_id: "test-instance" });
  });

  function createFirstStage(): Stage {
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
      status: "active",
    };
  }

  function createCollaborationForCreateIssue(opts: { summary?: string } = {}) {
    const firstStage = createFirstStage();
    const issue = createOpenIssue({
      summary: opts.summary ?? null,
      sop_snapshot: {
        key: "test",
        name: "Test SOP",
        description: null,
        shared_skill: null,
        stage_definitions: [{ key: "design", title: "Design", description: "", roles: [] }],
        transitions: [],
        scope: Scope.Workspace,
      },
    });
    const messagePort = createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
      setContext: setContextSpy as unknown as MessagePort["setContext"],
      appendEvent: appendEventSpy as unknown as MessagePort["appendEvent"],
      getMessage: (id) => messageStore.get(id),
      updateMessageTargets: vi.fn((id: number, toSpeakers: string[]) => {
        const msg = messageStore.get(id);
        if (msg) msg.to_speakers = toSpeakers;
      }) as unknown as MessagePort["updateMessageTargets"],
      getUnreadMessages: () => {
        const unread = [];
        for (const msg of messageStore.values()) {
          if (msg.status === "completed") unread.push(msg);
        }
        return unread;
      },
    });
    const stagePort = createMockStagePort({
      findStage: vi.fn().mockReturnValue(firstStage),
      createStage: vi.fn().mockReturnValue(firstStage),
      getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: null, role_key: "architect" }),
    });
    const snailPort = {
      ...createMockSnailPort(),
      invokeFirstCall: invokeFirstCallSpy as unknown as SnailPort["invokeFirstCall"],
    };

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(issue) }),
      createIssue: vi.fn().mockReturnValue(issue),
      stagePort,
      messagePort,
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    return { collaboration, firstStage };
  }

  it("createIssue 后自动发送 summary 作为用户消息并触发 agent", async () => {
    const { collaboration } = createCollaborationForCreateIssue({ summary: "帮我实现一个登录功能" });

    await collaboration.createIssue({
      workspace_path: "/workspace",
      title: "Test Issue",
      summary: "帮我实现一个登录功能",
      adopted_sop_key: "test-sop",
      snail_assignment_plan: {},
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(createMessageSpy).toHaveBeenCalled();
    /** 第一次调用是 kickoff 消息，from_speaker="user" */
    const firstCall = createMessageSpy.mock.calls[0][0];
    expect(firstCall.from_speaker).toBe("user");
    expect(firstCall.stage_id).toBe("s1");
    expect(firstCall.status).toBe("completed");
    expect(invokeFirstCallSpy).toHaveBeenCalled();
  });

  it("kickoff 消息内容为 summary 文本", async () => {
    const { collaboration } = createCollaborationForCreateIssue({ summary: "帮我实现一个登录功能" });

    await collaboration.createIssue({
      workspace_path: "/workspace",
      title: "Test Issue",
      summary: "帮我实现一个登录功能",
      adopted_sop_key: "test-sop",
      snail_assignment_plan: {},
    });

    /** setContext 被调用时，kind 和 text 应正确 */
    expect(setContextSpy).toHaveBeenCalled();
    const contextCall = setContextSpy.mock.calls[0];
    expect(contextCall[1]).toBe("final_text");
    expect(contextCall[2]).toBe("帮我实现一个登录功能");
  });

  it("summary 为空时 fallback 为系统消息", async () => {
    const { collaboration } = createCollaborationForCreateIssue({ summary: undefined });

    await collaboration.createIssue({
      workspace_path: "/workspace",
      title: "Test Issue",
      adopted_sop_key: "test-sop",
      snail_assignment_plan: {},
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(createMessageSpy).toHaveBeenCalled();
    const firstCall = createMessageSpy.mock.calls[0][0];
    /** from_speaker="" 表示系统消息 */
    expect(firstCall.from_speaker).toBe("");
    expect(firstCall.stage_id).toBe("s1");
  });

  it("summary 为空时消息内容为'开始执行。'", async () => {
    const { collaboration } = createCollaborationForCreateIssue({ summary: undefined });

    await collaboration.createIssue({
      workspace_path: "/workspace",
      title: "Test Issue",
      adopted_sop_key: "test-sop",
      snail_assignment_plan: {},
    });

    expect(setContextSpy).toHaveBeenCalled();
    const contextCall = setContextSpy.mock.calls[0];
    expect(contextCall[1]).toBe("final_text");
    expect(contextCall[2]).toBe("开始执行。");
  });

  it("无 default_role_instance 时不发送消息", async () => {
    const firstStage = createFirstStage();
    firstStage.default_role_instance = "";
    const issue = createOpenIssue({
      summary: "test",
      sop_snapshot: {
        key: "test",
        name: "Test SOP",
        description: null,
        shared_skill: null,
        stage_definitions: [{ key: "design", title: "Design", description: "", roles: [] }],
        transitions: [],
        scope: Scope.Workspace,
      },
    });
    const messagePort = createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
    });
    const stagePort = createMockStagePort({
      findStage: vi.fn().mockReturnValue(firstStage),
      createStage: vi.fn().mockReturnValue(firstStage),
    });

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(issue) }),
      createIssue: vi.fn().mockReturnValue(issue),
      stagePort,
      messagePort,
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collaboration.createIssue({
      workspace_path: "/workspace",
      title: "Test Issue",
      summary: "test",
      adopted_sop_key: "test-sop",
      snail_assignment_plan: {},
    });

    expect(createMessageSpy).not.toHaveBeenCalled();
    expect(invokeFirstCallSpy).not.toHaveBeenCalled();
  });
});
