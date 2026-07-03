import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage, Issue } from "@domain/issue/model";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
import type { MessageEvent } from "@domain/message/model";
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
  return { insert: vi.fn(), listPendingByStage: vi.fn().mockReturnValue([]), countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0), markProcessed: vi.fn(), deleteByStage: vi.fn() };
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

describe("detectStageTransition → backward signal stores suggestion", () => {
  it("stores backward signal suggestion with correct target_key and reason", async () => {
    const events: MessageEvent[] = [];
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
        getMessageEvents: () => events,
        findLatestMessage: () => ({ id: 100, stage_id: "review-stage", from_speaker: "reviewer-1", to_speakers: [], status: "completed" as const, created_at: "", ended_at: null }),
      }),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo,
    });

    events.push({
      id: 1, message_id: 100, seq: 1,
      payload: { type: "signal", signal: "stage_transition", stage_transition: {
        target_key: "development", signal_type: "gate_complete",
        reason: "Critical bugs found in review", gate_evidence: { "rev-01": "found 3 issues" },
      }},
      created_at: "",
    });

    await collab["detectStageTransition"](reviewStage, "reviewer-1", 100);

    const suggestions = collab["suggestions"].get("review-stage");
    expect(suggestions).toHaveLength(1);
    expect(suggestions![0].target_key).toBe("development");
    expect(suggestions![0].reason).toBe("Critical bugs found in review");
    expect(suggestions![0].gate_evidence).toEqual({ "rev-01": "found 3 issues" });
  });
});

describe("isBackwardTarget", () => {
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
      gate_evidence: { "rev-01": "SQL injection in login endpoint", "rev-02": "XSS in user profile" },
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
    expect(kickoffText).toContain("SQL injection in login endpoint");
    expect(kickoffText).toContain("XSS in user profile");
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
});
