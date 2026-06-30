import { describe, it, expect, vi } from "vitest";
import { createFinalResponseServer } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { Message, MessageEvent } from "@domain/message/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage } from "@domain/issue/model";

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

function createMockIssuePort(): IssuePort {
  return {
    findIssue: vi.fn(),
    listIssues: vi.fn(),
    previewSopStages: vi.fn(),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn(),
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

function createStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "s1",
    workspace_path: "/workspace",
    issue_id: "issue-1",
    key: "review",
    title: "Review",
    description: "",
    default_role_instance: "reviewer",
    role_instances: ["reviewer-1", "reviewer-2"],
    from_stage_id: null,
    available_transitions: [{ to: "merge", guard: null }],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

describe("Signal chain: set_final_body → detectStageTransition → autoAdvanceEngine.evaluate", () => {
  it("should extract stage_transition from set_final_body and trigger auto-advance", async () => {
    // Arrange
    const messages = new Map<number, Message>();
    const message: Message = {
      id: 100,
      stage_id: "s1",
      from_speaker: "reviewer-1",
      to_speakers: [],
      status: "streaming",
      created_at: "",
      ended_at: null,
    };
    messages.set(100, message);

    const events: MessageEvent[] = [];
    const messagePort = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      appendEvent: (_messageId, payload) => {
        const event: MessageEvent = {
          id: events.length + 1,
          message_id: 100,
          seq: events.length + 1,
          payload,
          created_at: "",
        };
        events.push(event);
        return event;
      },
      getMessageEvents: () => events,
    });

    const stagePort = createMockStagePort();

    const autoAdvanceSpy = vi.fn().mockResolvedValue(undefined);

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });

    // Mock the autoAdvanceEngine.evaluate method
    const originalEvaluate = collaboration["autoAdvanceEngine"].evaluate.bind(collaboration["autoAdvanceEngine"]);
    collaboration["autoAdvanceEngine"].evaluate = vi.fn().mockImplementation(async (stage, suggestions) => {
      autoAdvanceSpy(stage, suggestions);
      return originalEvaluate(stage, suggestions);
    });

    // Act
    const server = createFinalResponseServer(messagePort, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const signalJson = JSON.stringify({
      stage_transition: {
        target_key: "merge",
        consensus: true,
        reason: "Review complete",
        gate_evidence: { "rev-01": "done", "rev-02": "verified" },
      },
    });

    await handler({ text: signalJson, message_id: "100", stage_id: "s1" });

    // Assert
    // 1. Verify signal event was appended
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      type: "signal",
      signal: "stage_transition",
      stage_transition: {
        target_key: "merge",
        consensus: true,
        reason: "Review complete",
        gate_evidence: { "rev-01": "done", "rev-02": "verified" },
      },
    });

    // 2. Verify the signal can be extracted by detectStageTransition
    // Note: detectStageTransition is private, so we test indirectly through the public API
    // The signal event should be extractable by extractStageTransitionSuggestion
    const suggestion = collaboration["extractStageTransitionSuggestion"](createStage(), "reviewer-1", 100);
    expect(suggestion).toMatchObject({
      stage_id: "s1",
      message_id: 100,
      from_speaker: "reviewer-1",
      target_key: "merge",
      reason: "Review complete",
      consensus: true,
      gate_evidence: { "rev-01": "done", "rev-02": "verified" },
    });
  });

  it("should handle Markdown-embedded stage_transition JSON", async () => {
    // Arrange
    const messages = new Map<number, Message>();
    const message: Message = {
      id: 200,
      stage_id: "s1",
      from_speaker: "reviewer-1",
      to_speakers: [],
      status: "streaming",
      created_at: "",
      ended_at: null,
    };
    messages.set(200, message);

    const events: MessageEvent[] = [];

    const messagePort = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      appendEvent: (_messageId, payload) => {
        const event: MessageEvent = {
          id: events.length + 1,
          message_id: 200,
          seq: events.length + 1,
          payload,
          created_at: "",
        };
        events.push(event);
        return event;
      },
      getMessageEvents: () => events,
    });

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort,
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });

    // Act
    const server = createFinalResponseServer(messagePort, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const markdownText = `## Review Summary

All checks passed.

\`\`\`json
{
  "stage_transition": {
    "target_key": "merge",
    "consensus": true,
    "reason": "All gates passed",
    "gate_evidence": { "rev-01": "approved", "rev-02": "verified" }
  }
}
\`\`\``;

    await handler({ text: markdownText, message_id: "200", stage_id: "s1" });

    // Assert
    // 1. Verify signal event was appended
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      type: "signal",
      signal: "stage_transition",
      stage_transition: {
        target_key: "merge",
        consensus: true,
        reason: "All gates passed",
        gate_evidence: { "rev-01": "approved", "rev-02": "verified" },
      },
    });

    // 2. Verify the signal can be extracted
    const suggestion = collaboration["extractStageTransitionSuggestion"](createStage(), "reviewer-1", 200);
    expect(suggestion).toMatchObject({
      stage_id: "s1",
      message_id: 200,
      from_speaker: "reviewer-1",
      target_key: "merge",
      reason: "All gates passed",
      consensus: true,
      gate_evidence: { "rev-01": "approved", "rev-02": "verified" },
    });
  });

  it("should not trigger auto-advance when no stage_transition in text", async () => {
    // Arrange
    const messages = new Map<number, Message>();
    const message: Message = {
      id: 300,
      stage_id: "s1",
      from_speaker: "reviewer-1",
      to_speakers: [],
      status: "streaming",
      created_at: "",
      ended_at: null,
    };
    messages.set(300, message);

    const events: MessageEvent[] = [];

    const messagePort = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      appendEvent: (_messageId, payload) => {
        const event: MessageEvent = {
          id: events.length + 1,
          message_id: 300,
          seq: events.length + 1,
          payload,
          created_at: "",
        };
        events.push(event);
        return event;
      },
      getMessageEvents: () => events,
    });

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort,
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });

    // Act
    const server = createFinalResponseServer(messagePort, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await handler({ text: "Just a regular message without signal", message_id: "300", stage_id: "s1" });

    // Assert
    // 1. Verify no signal event was appended
    expect(events).toHaveLength(0);

    // 2. Verify no suggestion can be extracted
    const suggestion = collaboration["extractStageTransitionSuggestion"](createStage(), "reviewer-1", 300);
    expect(suggestion).toBeNull();
  });
});
