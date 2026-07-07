import { describe, it, expect, vi } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";

function createMockMessagePort(overrides: Partial<MessagePort> = {}): MessagePort {
  return {
    createMessage: vi.fn().mockReturnValue({ id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["user"], status: "completed", created_at: "", ended_at: null }),
    getMessage: vi.fn(),
    getMessageEvents: vi.fn().mockReturnValue([]),
    getContext: vi.fn(),
    setContext: vi.fn(),
    appendEvent: vi.fn(),
    completeMessage: vi.fn(),
    updateMessageTargets: vi.fn(),
    findLatestMessage: vi.fn().mockReturnValue({ id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["user"], status: "completed", created_at: "", ended_at: null }),
    findLatestMessageBySpeaker: vi.fn(),
    findLatestMessageByIssueId: vi.fn(),
    findLatestRespondingSpeaker: vi.fn(),
    getUnreadMessages: vi.fn().mockReturnValue([]),
    listMessagesByStatus: vi.fn().mockReturnValue([]),
    listMessages: vi.fn().mockReturnValue([]),
    listMessagesWindow: vi.fn().mockReturnValue([]),
    searchContext: vi.fn().mockReturnValue([]),
    getCursor: vi.fn().mockReturnValue(0),
    advanceCursor: vi.fn(),
    initCursor: vi.fn(),
    ...overrides,
  };
}

function createMockStagePort(overrides: Partial<StagePort> = {}): StagePort {
  return {
    findStage: vi.fn().mockReturnValue({
      id: "s1", workspace_path: "/ws", issue_id: "i1", key: "development", title: "Dev", description: "",
      default_role_instance: "dev", role_instances: ["dev"], from_stage_id: null,
      available_transitions: [{ to: "review", guard: null }], output_artifacts: {}, entered_at: "", left_at: null,
    }),
    listStages: vi.fn().mockReturnValue([]),
    listOpenStageIds: vi.fn().mockReturnValue([]),
    listAllOpenStageIds: vi.fn().mockReturnValue([]),
    previewStage: vi.fn(),
    getStageSnailAssignmentPlan: vi.fn(),
    transaction: vi.fn((fn) => fn()),
    createStage: vi.fn(),
    addOutputArtifacts: vi.fn(),
    advanceStage: vi.fn(),
    rollbackStage: vi.fn(),
    recordAudit: vi.fn(),
    getAuditTrail: vi.fn().mockReturnValue([]),
    switchSnail: vi.fn(),
    setSnailInstanceId: vi.fn(),
    getRoleSnailAssignments: vi.fn().mockReturnValue([]),
    getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: "inst-1", role_key: "developer" }),
    ...overrides,
  };
}

function createMockStageSuggestionRepo(): StageSuggestionRepository {
  return {
    insert: vi.fn(),
    listPendingByStage: vi.fn().mockReturnValue([]),
    listActiveByStage: vi.fn().mockReturnValue([]),
    countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0),
    markSeen: vi.fn(),
    markProcessed: vi.fn(),
    deleteByStage: vi.fn(),
  };
}

function createMockIssuePort(overrides: Partial<IssuePort> = {}): IssuePort {
  return {
    findIssue: vi.fn().mockReturnValue({ id: "i1", workspace_path: "/ws", title: "Test", summary: null, sop_snapshot: { stage_definitions: [], shared_skill: null }, snail_assignment_plan: {}, context: {}, created_at: "", closed_at: null, close_summary: null }),
    listIssues: vi.fn().mockReturnValue([]),
    previewSopStages: vi.fn().mockReturnValue([]),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn(),
    updateCloseSummary: vi.fn(),
    ...overrides,
  };
}

function createMockMcpMessageStore(): McpMessageStore {
  return { getMcpRoutingTargets: vi.fn(), setMcpRoutingTargets: vi.fn(), deleteMcpRoutingTargets: vi.fn() };
}

function createMockLiteAIPort(): LiteAIPort {
  return { getConfig: vi.fn().mockReturnValue(null), chat: vi.fn() };
}

describe("User Call rate limiting (B4)", () => {
  it("should suppress duplicate user call within rate limit window", async () => {
    const msg = { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["user"], status: "completed", created_at: "", ended_at: null };
    const createMessage = vi.fn().mockReturnValue(msg);
    const messagePort = createMockMessagePort({ createMessage, getMessage: vi.fn().mockReturnValue(msg) });
    const onUserCalled = vi.fn();
    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort,
      snailPort: { invokeFirstCall: vi.fn(), invokeResume: vi.fn(), findByKey: vi.fn() } as unknown as SnailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
      userCallRateLimitMs: 30000,
    });

    collaboration.registerIssueConsumer("i1", { onUserCalled, onEvent: vi.fn(), onMessageCompleted: vi.fn() });

    // First call should trigger onUserCalled
    await collaboration.sendMessage("s1", "hello", "user", ["user"]);
    // Second call within rate limit should NOT trigger onUserCalled again
    await collaboration.sendMessage("s1", "hello again", "user", ["user"]);
    // Wait for async fire-and-forget chains to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // onUserCalled should only be called once (first call), not twice
    expect(onUserCalled.mock.calls).toHaveLength(1);
  });

  it("should allow user call after rate limit window expires", async () => {
    const msg1 = { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["user"], status: "completed", created_at: "", ended_at: null };
    const msg2 = { id: 2, stage_id: "s1", from_speaker: "user", to_speakers: ["user"], status: "completed", created_at: "", ended_at: null };
    const createMessage = vi.fn()
      .mockReturnValueOnce(msg1)
      .mockReturnValueOnce(msg2);
    const getMessage = vi.fn().mockImplementation((id: number) => id === 1 ? msg1 : msg2);
    const messagePort = createMockMessagePort({ createMessage, getMessage });
    const onUserCalled = vi.fn();
    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort,
      snailPort: { invokeFirstCall: vi.fn(), invokeResume: vi.fn(), findByKey: vi.fn() } as unknown as SnailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
      userCallRateLimitMs: 1, // 1ms for testing
    });

    collaboration.registerIssueConsumer("i1", { onUserCalled, onEvent: vi.fn(), onMessageCompleted: vi.fn() });

    await collaboration.sendMessage("s1", "hello", "user", ["user"]);
    // Wait for rate limit to expire
    await new Promise(resolve => setTimeout(resolve, 10));
    await collaboration.sendMessage("s1", "hello again", "user", ["user"]);

    // Wait for async fire-and-forget chains to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    // Both calls should trigger onUserCalled
    expect(onUserCalled.mock.calls).toHaveLength(2);
  });
});
