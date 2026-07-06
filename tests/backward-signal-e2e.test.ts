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
    getMessage: () => undefined, listMessages: () => [], listMessagesWindow: () => [], searchContext: () => [],
    listMessagesByStatus: () => [], updateMessageTargets: () => {}, completeMessage: () => {},
    appendEvent: () => ({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
    getMessageEvents: () => [], getContext: () => null, setContext: () => {}, getCursor: () => 0,
    advanceCursor: () => {}, getUnreadMessages: () => [], initCursor: () => {},
    findLatestRespondingSpeaker: () => null, findLatestMessage: () => undefined, findLatestMessageBySpeaker: () => undefined, ...overrides,
  };
}

function createMockMcpMessageStore(): McpMessageStore {
  return { getMcpRoutingTargets: () => undefined, setMcpRoutingTargets: () => {}, deleteMcpRoutingTargets: () => {} };
}

function createMockStageSuggestionRepo(): StageSuggestionRepository {
  return { insert: vi.fn(), listPendingByStage: vi.fn().mockReturnValue([]), listActiveByStage: vi.fn().mockReturnValue([]), countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0), markSeen: vi.fn(), markProcessed: vi.fn(), deleteByStage: vi.fn() };
}

function createMockIssuePort(overrides: Partial<IssuePort> = {}): IssuePort {
  return { findIssue: vi.fn(), listIssues: vi.fn(), previewSopStages: vi.fn(), validateSnailAssignmentPlan: vi.fn(), updateContext: vi.fn(), closeIssue: vi.fn(), updateCloseSummary: vi.fn(), ...overrides };
}

function createMockStagePort(overrides: Partial<StagePort> = {}): StagePort {
  return {
    findStage: vi.fn(), listStages: vi.fn().mockReturnValue([]), listOpenStageIds: vi.fn(), listAllOpenStageIds: vi.fn(),
    previewStage: vi.fn(), getStageSnailAssignmentPlan: vi.fn(), transaction: vi.fn((fn) => fn()), createStage: vi.fn(),
    addOutputArtifacts: vi.fn(), advanceStage: vi.fn(), rollbackStage: vi.fn(), recordAudit: vi.fn(), getAuditTrail: vi.fn(),
    switchSnail: vi.fn(), setSnailInstanceId: vi.fn(), getRoleSnailAssignments: vi.fn(), getRoleSnailAssignment: vi.fn(),
    ...overrides,
  };
}

function createMockSnailPort(): SnailPort {
  return { list: vi.fn(), findByKey: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), invokeFirstCall: vi.fn(), invokeResume: vi.fn() };
}

function createMockLiteAIPort(): LiteAIPort { return { getConfig: vi.fn(), chat: vi.fn() }; }

function createStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "review-stage", workspace_path: "/workspace", issue_id: "issue-1", key: "review", title: "Review",
    description: "Review stage", default_role_instance: "reviewer-1", role_instances: ["reviewer-1", "reviewer-2"],
    from_stage_id: "dev-stage", available_transitions: [{ to: "merge", guard: null }, { to: "development", guard: null }],
    output_artifacts: {}, entered_at: "2026-07-02T12:00:00Z", left_at: null, ...overrides,
  };
}

function createDevStage(): Stage {
  return {
    id: "dev-stage", workspace_path: "/workspace", issue_id: "issue-1", key: "development", title: "Development",
    description: "Development stage", default_role_instance: "developer", role_instances: ["developer"],
    from_stage_id: null, available_transitions: [{ to: "review", guard: null }],
    output_artifacts: {}, entered_at: "2026-07-02T10:00:00Z", left_at: null,
  };
}

function createOpenIssue(): Issue {
  return {
    id: "issue-1", workspace_path: "/workspace", title: "Test Issue", summary: "Test summary",
    sop_snapshot: { key: "code-delivery", name: "Code Delivery", description: null, shared_skill: "cd-shared", stage_definitions: [], transitions: [], scope: Scope.Workspace },
    snail_assignment_plan: {}, context: { worktree_path: "/wt", branch_name: "feature-x", pr_url: "https://github.com/pr/1" },
    created_at: "2026-07-02T09:00:00Z", closed_at: null, close_summary: null,
  };
}

describe("requestTransition → backward signal stores suggestion", () => {
  it("stores backward signal suggestion with correct target_key and reason", async () => {
    const reviewStage = createStage();
    const devStage = createDevStage();
    const stageSuggestionRepo = createMockStageSuggestionRepo();

    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        findStage: vi.fn().mockReturnValue(reviewStage),
        listStages: vi.fn().mockReturnValue([devStage, reviewStage]),
      }),
      messagePort: createMockMessagePort({
        findLatestMessage: () => ({ id: 100, stage_id: "review-stage", from_speaker: "reviewer-1", to_speakers: [], status: "streaming" as const, created_at: "", ended_at: null }),
        findLatestMessageBySpeaker: () => ({ id: 100, stage_id: "review-stage", from_speaker: "reviewer-1", to_speakers: [], status: "streaming" as const, created_at: "", ended_at: null }),
      }),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo,
    });

    await collab.requestTransition({
      stageId: "review-stage",
      fromSpeaker: "reviewer-1",
      targetKey: "development",
      signalType: "gate_complete",
      reason: "Critical bugs found in review",
    });

    const suggestions = collab["suggestions"].get("review-stage");
    expect(suggestions).toHaveLength(1);
    expect(suggestions![0].target_key).toBe("development");
    expect(suggestions![0].reason).toBe("Critical bugs found in review");
  });
});

describe("isBackwardTarget", () => {
  /** [design-time] 标注：以下测试使用 left_at: null 的已离开 stage，
   * 此场景在 append-only 模型下不可能出现（已离开的 stage 必有 left_at）。
   * 保留测试以覆盖 isBackwardTarget 逻辑本身，待 transferStage 实现后激活。 */
  it("returns true when target key exists in stage history without left_at", () => {
    const reviewStage = createStage();
    const devStage = createDevStage();
    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        listStages: vi.fn().mockReturnValue([devStage, reviewStage]),
      }),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    expect(collab["isBackwardTarget"]("issue-1", "development")).toBe(true);
  });

  it("returns false when target key does not exist in stage history", () => {
    const reviewStage = createStage();
    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        listStages: vi.fn().mockReturnValue([reviewStage]),
      }),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    expect(collab["isBackwardTarget"]("issue-1", "development")).toBe(false);
  });
});

describe("autoInvokeBackwardStage preserves reason and evidence", () => {
  /** [design-time] 标注：以下测试使用 left_at: null 的已离开 stage，
   * 此场景在 append-only 模型下不可能出现（已离开的 stage 必有 left_at）。
   * 时序修正后 isBackwardTarget 对所有转移返回 false，autoInvokeBackwardStage 为死代码。
   * 保留测试覆盖逻辑本身，待 transferStage 实现后激活。 */
  let createMessageSpy: ReturnType<typeof vi.fn>;
  let setContextSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createMessageSpy = vi.fn().mockImplementation((input) => ({ id: 200, ...input, created_at: "", ended_at: null }));
    setContextSpy = vi.fn();
  });

  it("kickoff message contains correct reason and evidence after backward transfer", async () => {
    const reviewStage = createStage();
    const devStage = createDevStage();
    const messageStore = new Map<number, any>();
    messageStore.set(1, { id: 1, stage_id: "review-stage", from_speaker: "user", to_speakers: [], status: "completed", created_at: "", ended_at: null });

    const messagePort = createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
      setContext: setContextSpy as unknown as MessagePort["setContext"],
      appendEvent: vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
      completeMessage: vi.fn(),
      getMessage: (id) => messageStore.get(id),
      updateMessageTargets: vi.fn((id: number, toSpeakers: string[]) => { const msg = messageStore.get(id); if (msg) msg.to_speakers = toSpeakers; }),
      getUnreadMessages: () => { const unread = []; for (const msg of messageStore.values()) { if (msg.from_speaker === "user" && msg.status === "completed") unread.push(msg); } return unread; },
    });

    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        findStage: vi.fn().mockReturnValue(reviewStage),
        listStages: vi.fn().mockReturnValue([devStage, reviewStage]),
        advanceStage: vi.fn().mockReturnValue(devStage),
        getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: "test-instance", role_key: "developer" }),
      }),
      messagePort,
      snailPort: { ...createMockSnailPort(), invokeResume: vi.fn().mockResolvedValue({ snail_instance_id: "test-instance" }) },
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    // Pre-populate suggestions with a backward signal
    collab["suggestions"].set("review-stage", [{
      stage_id: "review-stage", message_id: 100, from_speaker: "reviewer-1", target_key: "development",
      reason: "Critical security vulnerability found in auth module", guard: null, artifacts: {},
      created_at: new Date().toISOString(), signal_type: "gate_complete",
    }]);

    await collab.advanceStage("review-stage", "development");
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(createMessageSpy).toHaveBeenCalled();
    const contextCall = setContextSpy.mock.calls.find(
      (call: any[]) => call[1] === "final_text" && typeof call[2] === "string" && call[2].includes("被重新激活")
    );
    expect(contextCall).toBeDefined();
    const kickoffText = contextCall![2] as string;
    expect(kickoffText).toContain("Critical security vulnerability found in auth module");
    expect(kickoffText).not.toContain("未指定原因");
  });

  it("kickoff uses defaults when no suggestions exist for backward transfer", async () => {
    const reviewStage = createStage();
    const devStage = createDevStage();
    const messageStore = new Map<number, any>();
    messageStore.set(1, { id: 1, stage_id: "review-stage", from_speaker: "user", to_speakers: [], status: "completed", created_at: "", ended_at: null });

    const messagePort = createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
      setContext: setContextSpy as unknown as MessagePort["setContext"],
      appendEvent: vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
      completeMessage: vi.fn(),
      getMessage: (id) => messageStore.get(id),
      updateMessageTargets: vi.fn((id: number, toSpeakers: string[]) => { const msg = messageStore.get(id); if (msg) msg.to_speakers = toSpeakers; }),
      getUnreadMessages: () => { const unread = []; for (const msg of messageStore.values()) { if (msg.from_speaker === "user" && msg.status === "completed") unread.push(msg); } return unread; },
    });

    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        findStage: vi.fn().mockReturnValue(reviewStage),
        listStages: vi.fn().mockReturnValue([devStage, reviewStage]),
        advanceStage: vi.fn().mockReturnValue(devStage),
        getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: "test-instance", role_key: "developer" }),
      }),
      messagePort,
      snailPort: { ...createMockSnailPort(), invokeResume: vi.fn().mockResolvedValue({ snail_instance_id: "test-instance" }) },
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collab.advanceStage("review-stage", "development");
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(createMessageSpy).toHaveBeenCalled();
    const contextCall = setContextSpy.mock.calls.find(
      (call: any[]) => call[1] === "final_text" && typeof call[2] === "string" && call[2].includes("被重新激活")
    );
    expect(contextCall).toBeDefined();
    expect(contextCall![2]).toContain("未指定原因");
  });

  it("userHint 优先于打回原因 kickoff：backward 场景下用户消息优先", async () => {
    const reviewStage = createStage();
    const devStage = createDevStage();
    const messageStore = new Map<number, any>();
    messageStore.set(1, { id: 1, stage_id: "dev-stage", from_speaker: "user", to_speakers: [], status: "completed", created_at: "", ended_at: null });

    const messagePort = createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
      setContext: setContextSpy as unknown as MessagePort["setContext"],
      appendEvent: vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
      completeMessage: vi.fn(),
      getMessage: (id) => messageStore.get(id),
      updateMessageTargets: vi.fn((id: number, toSpeakers: string[]) => { const msg = messageStore.get(id); if (msg) msg.to_speakers = toSpeakers; }),
      getUnreadMessages: () => { const unread = []; for (const msg of messageStore.values()) { if (msg.from_speaker === "user" && msg.status === "completed") unread.push(msg); } return unread; },
    });

    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        findStage: vi.fn().mockReturnValue(reviewStage),
        listStages: vi.fn().mockReturnValue([devStage, reviewStage]),
        advanceStage: vi.fn().mockReturnValue(devStage),
        getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: "test-instance", role_key: "developer" }),
      }),
      messagePort,
      snailPort: { ...createMockSnailPort(), invokeResume: vi.fn().mockResolvedValue({ snail_instance_id: "test-instance" }) },
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    /** 注入 backward suggestion */
    collab["suggestions"].set("review-stage", [{
      stage_id: "review-stage", message_id: 100, from_speaker: "reviewer-1", target_key: "development",
      reason: "Critical security vulnerability found", guard: null, artifacts: {},
      created_at: new Date().toISOString(), signal_type: "gate_complete",
    }]);

    await collab.advanceStage("review-stage", "development", "我已修复 SQL 注入，请继续开发");
    await new Promise(resolve => setTimeout(resolve, 10));

    /** userHint 作为用户消息发送（from_speaker=user），不使用打回原因 kickoff */
    expect(createMessageSpy).toHaveBeenCalled();
    const kickoffCall = createMessageSpy.mock.calls[0][0];
    expect(kickoffCall.from_speaker).toBe("user");
    /** final_text 是用户提供的文本 */
    const contextCall = setContextSpy.mock.calls.find(
      (call: any[]) => call[1] === "final_text" && call[2] === "我已修复 SQL 注入，请继续开发"
    );
    expect(contextCall).toBeDefined();
    /** 不包含打回原因 kickoff */
    const backwardKickoff = setContextSpy.mock.calls.find(
      (call: any[]) => call[1] === "final_text" && typeof call[2] === "string" && call[2].includes("被重新激活")
    );
    expect(backwardKickoff).toBeUndefined();
  });
});

describe("时序修正：isBackwardTarget 在 advanceStage 之前调用", () => {
  let createMessageSpy: ReturnType<typeof vi.fn>;
  let setContextSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createMessageSpy = vi.fn().mockImplementation((input) => ({ id: 200, ...input, created_at: "", ended_at: null }));
    setContextSpy = vi.fn();
  });

  /**
   * B-1: 首次正向推进到目标 stage → kickoff 消息为"开始执行。"
   * 模拟真实 append-only 行为：listStages 在 advanceStage 前后返回不同值。
   * 旧代码（isBackwardTarget 在 advanceStage 之后调用）会误判为反向重新激活。
   */
  it("B-1: 首次正向推进时 kickoff 为'开始执行。'，不包含'被重新激活'", async () => {
    const designStage: Stage = {
      id: "design-stage", workspace_path: "/workspace", issue_id: "issue-1", key: "design", title: "Design",
      description: "", default_role_instance: "architect", role_instances: ["architect"],
      from_stage_id: null, available_transitions: [{ to: "development", guard: null }],
      output_artifacts: {}, entered_at: "2026-07-02T10:00:00Z", left_at: "2026-07-02T12:00:00Z",
    };
    const devStage: Stage = {
      id: "dev-stage", workspace_path: "/workspace", issue_id: "issue-1", key: "development", title: "Development",
      description: "", default_role_instance: "developer", role_instances: ["developer"],
      from_stage_id: "design-stage", available_transitions: [],
      output_artifacts: {}, entered_at: "2026-07-02T12:00:00Z", left_at: null,
    };

    /** 模拟真实行为：advanceStage 调用前 listStages 不含新 stage，调用后含新 stage */
    let advanceStageCalled = false;
    const listStagesMock = vi.fn(() => {
      if (!advanceStageCalled) return [designStage];
      return [designStage, devStage];
    });
    const advanceStageMock = vi.fn(() => {
      advanceStageCalled = true;
      return devStage;
    });

    const messageStore = new Map<number, any>();
    messageStore.set(1, { id: 1, stage_id: "dev-stage", from_speaker: "user", to_speakers: [], status: "completed", created_at: "", ended_at: null });

    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        findStage: vi.fn().mockReturnValue(designStage),
        listStages: listStagesMock,
        advanceStage: advanceStageMock as unknown as StagePort["advanceStage"],
        getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: null, role_key: "developer" }),
      }),
      messagePort: createMockMessagePort({
        createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
        setContext: setContextSpy as unknown as MessagePort["setContext"],
        appendEvent: vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
        completeMessage: vi.fn(),
        getMessage: (id) => messageStore.get(id),
        updateMessageTargets: vi.fn(),
        getUnreadMessages: () => [],
      }),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collab.advanceStage("design-stage", "development");
    await new Promise(resolve => setTimeout(resolve, 10));

    /** kickoff 消息应为"开始执行。"，不包含"被重新激活" */
    const finalTextCall = setContextSpy.mock.calls.find(
      (call: any[]) => call[1] === "final_text" && typeof call[2] === "string"
    );
    expect(finalTextCall).toBeDefined();
    expect(finalTextCall![2]).toContain("开始执行");
    expect(finalTextCall![2]).not.toContain("被重新激活");
  });

  /**
   * B-2: 反向推进到已在历史中的 stage（append-only 模型，目标已离开）→ kickoff 消息为"重新进入"
   */
  it("B-2: 反向推进到已离开的 stage → kickoff 为'重新进入'，不包含'被重新激活'", async () => {
    const devStageLeft: Stage = {
      id: "dev-stage-old", workspace_path: "/workspace", issue_id: "issue-1", key: "development", title: "Development",
      description: "", default_role_instance: "developer", role_instances: ["developer"],
      from_stage_id: null, available_transitions: [{ to: "review", guard: null }],
      output_artifacts: {}, entered_at: "2026-07-02T10:00:00Z", left_at: "2026-07-02T14:00:00Z",
    };
    const reviewStage: Stage = {
      id: "review-stage", workspace_path: "/workspace", issue_id: "issue-1", key: "review", title: "Review",
      description: "", default_role_instance: "reviewer", role_instances: ["reviewer"],
      from_stage_id: "dev-stage-old", available_transitions: [{ to: "development", guard: null }],
      output_artifacts: {}, entered_at: "2026-07-02T14:00:00Z", left_at: null,
    };
    const devStageNew: Stage = {
      id: "dev-stage-new", workspace_path: "/workspace", issue_id: "issue-1", key: "development", title: "Development",
      description: "", default_role_instance: "developer", role_instances: ["developer"],
      from_stage_id: "review-stage", available_transitions: [],
      output_artifacts: {}, entered_at: "2026-07-03T10:00:00Z", left_at: null,
    };

    /** listStages 返回已离开的 dev stage + 当前 review stage（append-only 真实行为） */
    let advanceStageCalled = false;
    const listStagesMock = vi.fn(() => {
      if (!advanceStageCalled) return [devStageLeft, reviewStage];
      return [devStageLeft, reviewStage, devStageNew];
    });
    const advanceStageMock = vi.fn(() => {
      advanceStageCalled = true;
      return devStageNew;
    });

    const messageStore = new Map<number, any>();
    messageStore.set(1, { id: 1, stage_id: "dev-stage-new", from_speaker: "user", to_speakers: [], status: "completed", created_at: "", ended_at: null });

    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        findStage: vi.fn().mockReturnValue(reviewStage),
        listStages: listStagesMock,
        advanceStage: advanceStageMock as unknown as StagePort["advanceStage"],
        getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: null, role_key: "developer" }),
      }),
      messagePort: createMockMessagePort({
        createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
        setContext: setContextSpy as unknown as MessagePort["setContext"],
        appendEvent: vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
        completeMessage: vi.fn(),
        getMessage: (id) => messageStore.get(id),
        updateMessageTargets: vi.fn(),
        getUnreadMessages: () => [],
      }),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collab.advanceStage("review-stage", "development");
    await new Promise(resolve => setTimeout(resolve, 10));

    /** kickoff 消息应为"重新进入 [development] 阶段"，不包含"被重新激活" */
    const finalTextCall = setContextSpy.mock.calls.find(
      (call: any[]) => call[1] === "final_text" && typeof call[2] === "string"
    );
    expect(finalTextCall).toBeDefined();
    expect(finalTextCall![2]).toContain("重新进入");
    expect(finalTextCall![2]).toContain("development");
    expect(finalTextCall![2]).not.toContain("被重新激活");
  });

  /**
   * B-3: forceAdvance 路径与 advanceStage 一致的 kickoff 消息
   */
  it("B-3: forceAdvance 正向推进时 kickoff 为'开始执行。'，不包含'被重新激活'", async () => {
    const devStage: Stage = {
      id: "dev-stage", workspace_path: "/workspace", issue_id: "issue-1", key: "development", title: "Development",
      description: "", default_role_instance: "developer", role_instances: ["developer"],
      from_stage_id: null, available_transitions: [{ to: "review", guard: null }],
      output_artifacts: {}, entered_at: "2026-07-02T10:00:00Z", left_at: null,
    };
    const reviewStage: Stage = {
      id: "review-stage", workspace_path: "/workspace", issue_id: "issue-1", key: "review", title: "Review",
      description: "", default_role_instance: "reviewer", role_instances: ["reviewer"],
      from_stage_id: "dev-stage", available_transitions: [],
      output_artifacts: {}, entered_at: "2026-07-02T12:00:00Z", left_at: null,
    };

    let advanceStageCalled = false;
    const listStagesMock = vi.fn(() => {
      if (!advanceStageCalled) return [devStage];
      return [devStage, reviewStage];
    });
    const advanceStageMock = vi.fn(() => {
      advanceStageCalled = true;
      return reviewStage;
    });

    const messageStore = new Map<number, any>();
    messageStore.set(1, { id: 1, stage_id: "review-stage", from_speaker: "user", to_speakers: [], status: "completed", created_at: "", ended_at: null });

    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort({ findIssue: vi.fn().mockReturnValue(createOpenIssue()) }),
      createIssue: vi.fn(),
      stagePort: createMockStagePort({
        findStage: vi.fn().mockReturnValue(devStage),
        listStages: listStagesMock,
        advanceStage: advanceStageMock as unknown as StagePort["advanceStage"],
        recordAudit: vi.fn(),
        getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: null, role_key: "reviewer" }),
      }),
      messagePort: createMockMessagePort({
        createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
        setContext: setContextSpy as unknown as MessagePort["setContext"],
        appendEvent: vi.fn().mockReturnValue({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
        completeMessage: vi.fn(),
        getMessage: (id) => messageStore.get(id),
        updateMessageTargets: vi.fn(),
        getUnreadMessages: () => [],
      }),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    await collab.forceAdvance("dev-stage", "review");
    await new Promise(resolve => setTimeout(resolve, 10));

    const finalTextCall = setContextSpy.mock.calls.find(
      (call: any[]) => call[1] === "final_text" && typeof call[2] === "string"
    );
    expect(finalTextCall).toBeDefined();
    expect(finalTextCall![2]).toContain("开始执行");
    expect(finalTextCall![2]).not.toContain("被重新激活");
  });
});
