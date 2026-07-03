import { describe, it, expect, vi } from "vitest";
import { createFinalResponseServer } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
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

function createMockStageSuggestionRepo(): StageSuggestionRepository {
  return {
    insert: vi.fn(),
    listPendingByStage: vi.fn().mockReturnValue([]),
    countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0),
    markProcessed: vi.fn(),
    deleteByStage: vi.fn(),
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
      findLatestMessage: () => messages.get(100),
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
      stageSuggestionRepo: createMockStageSuggestionRepo(),
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
    const suggestion = collaboration["signalParser"].extract(createStage(), "reviewer-1", 100);
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
      findLatestMessage: () => messages.get(200),
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
      stageSuggestionRepo: createMockStageSuggestionRepo(),
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
    const suggestion = collaboration["signalParser"].extract(createStage(), "reviewer-1", 200);
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
      findLatestMessage: () => messages.get(300),
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
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    // Act
    const server = createFinalResponseServer(messagePort, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await handler({ text: "Just a regular message without signal", message_id: "300", stage_id: "s1" });

    // Assert
    // 1. Verify no signal event was appended
    expect(events).toHaveLength(0);

    // 2. Verify no suggestion can be extracted
    const suggestion = collaboration["signalParser"].extract(createStage(), "reviewer-1", 300);
    expect(suggestion).toBeNull();
  });
});

describe("L1: Signal interception for unresolved adversarial findings", () => {
  function createL1Collaboration(events: MessageEvent[]) {
    const messages = new Map<number, Message>();
    const messagePort = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessage: () => messages.get(100),
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
    const stageSuggestionRepo = createMockStageSuggestionRepo();
    const stagePort = createMockStagePort();
    (stagePort.findStage as ReturnType<typeof vi.fn>).mockReturnValue(createStage());
    const issuePort = createMockIssuePort();
    (issuePort.findIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "issue-1", workspace_path: "/workspace", title: "Test", summary: null,
      context: { pr_url: "https://github.com/pr/1" },
      sop_snapshot: { stage_definitions: [
        { key: "review", title: "Review", description: "", roles: [], auto_advance: {
          required_context_fields: ["pr_url"],
          gate_ids: ["rev-01", "rev-02", "rev-03", "rev-04"],
          accepted_signal_types: ["adversarial_consensus"],
          blocking_rules: [{ type: "unresolved_findings" }],
        }},
      ]},
    });
    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo,
    });
    messages.set(100, {
      id: 100, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [],
      status: "streaming", created_at: "", ended_at: null,
    });
    return { collaboration, stageSuggestionRepo, messagePort };
  }

  it("blocks adversarial_consensus signal with unresolved findings (disposition=none)", async () => {
    const events: MessageEvent[] = [];
    const { collaboration, stageSuggestionRepo } = createL1Collaboration(events);

    const artifact = {
      independent_verification: [{ command: "tsc", actual_output: "compiled with zero errors", executed_at: new Date().toISOString() }],
      adversarial_findings: [{ dimension: "completeness", finding: "found bug", disposition: "none" }],
      audit_trail: { events: [{ timestamp: new Date().toISOString(), event_type: "review_started" as const, detail: "started" }] },
    };

    // Simulate the signal event being appended
    events.push({
      id: 1, message_id: 100, seq: 1,
      payload: { type: "signal", signal: "stage_transition", stage_transition: {
        target_key: "merge", consensus: true, signal_type: "adversarial_consensus",
        reason: "Review complete", adversarial_artifact: artifact,
      }},
      created_at: "",
    });

    const stage = createStage();
    await collaboration["detectStageTransition"](stage, "reviewer-1", 100);

    // L1: suggestion should NOT be persisted
    expect(stageSuggestionRepo.insert).not.toHaveBeenCalled();
  });

  it("blocks adversarial_consensus signal with empty string disposition", async () => {
    const events: MessageEvent[] = [];
    const { collaboration, stageSuggestionRepo } = createL1Collaboration(events);

    const artifact = {
      independent_verification: [{ command: "tsc", actual_output: "compiled with zero errors", executed_at: new Date().toISOString() }],
      adversarial_findings: [{ dimension: "completeness", finding: "found bug", disposition: "" }],
      audit_trail: { events: [{ timestamp: new Date().toISOString(), event_type: "review_started" as const, detail: "started" }] },
    };

    events.push({
      id: 1, message_id: 100, seq: 1,
      payload: { type: "signal", signal: "stage_transition", stage_transition: {
        target_key: "merge", consensus: true, signal_type: "adversarial_consensus",
        reason: "Review complete", adversarial_artifact: artifact,
      }},
      created_at: "",
    });

    const stage = createStage();
    await collaboration["detectStageTransition"](stage, "reviewer-1", 100);

    expect(stageSuggestionRepo.insert).not.toHaveBeenCalled();
  });

  it("allows adversarial_consensus signal when all findings are resolved", async () => {
    const events: MessageEvent[] = [];
    const { collaboration, stageSuggestionRepo } = createL1Collaboration(events);

    const artifact = {
      independent_verification: [{ command: "tsc", actual_output: "compiled with zero errors", executed_at: new Date().toISOString() }],
      adversarial_findings: [{ dimension: "completeness", finding: "found bug", disposition: "fixed" }],
      audit_trail: { events: [{ timestamp: new Date().toISOString(), event_type: "review_started" as const, detail: "started" }] },
    };

    events.push({
      id: 1, message_id: 100, seq: 1,
      payload: { type: "signal", signal: "stage_transition", stage_transition: {
        target_key: "merge", consensus: true, signal_type: "adversarial_consensus",
        reason: "Review complete", adversarial_artifact: artifact,
      }},
      created_at: "",
    });

    const stage = createStage();
    await collaboration["detectStageTransition"](stage, "reviewer-1", 100);

    // Should be persisted (L1 passes, engine evaluation happens next)
    expect(stageSuggestionRepo.insert).toHaveBeenCalled();
  });

  it("allows adversarial_consensus signal when findings are 'no issues' with disposition=none", async () => {
    const events: MessageEvent[] = [];
    const { collaboration, stageSuggestionRepo } = createL1Collaboration(events);

    const artifact = {
      independent_verification: [{ command: "tsc", actual_output: "compiled with zero errors", executed_at: new Date().toISOString() }],
      adversarial_findings: [{ dimension: "completeness", finding: "no issues", disposition: "none" }],
      audit_trail: { events: [{ timestamp: new Date().toISOString(), event_type: "review_started" as const, detail: "started" }] },
    };

    events.push({
      id: 1, message_id: 100, seq: 1,
      payload: { type: "signal", signal: "stage_transition", stage_transition: {
        target_key: "merge", consensus: true, signal_type: "adversarial_consensus",
        reason: "Review complete", adversarial_artifact: artifact,
      }},
      created_at: "",
    });

    const stage = createStage();
    await collaboration["detectStageTransition"](stage, "reviewer-1", 100);

    // "no issues" findings are exempt from L1
    expect(stageSuggestionRepo.insert).toHaveBeenCalled();
  });

  it("does not apply L1 to gate_complete signals", async () => {
    const events: MessageEvent[] = [];
    const { collaboration, stageSuggestionRepo } = createL1Collaboration(events);

    events.push({
      id: 1, message_id: 100, seq: 1,
      payload: { type: "signal", signal: "stage_transition", stage_transition: {
        target_key: "review", signal_type: "gate_complete",
        reason: "All gates passed", gate_evidence: { "dev-01": "done" },
      }},
      created_at: "",
    });

    const stage = createStage({ key: "development", available_transitions: [{ to: "review", guard: null }] });
    await collaboration["detectStageTransition"](stage, "dev", 100);

    // gate_complete signals should NOT be blocked by L1
    expect(stageSuggestionRepo.insert).toHaveBeenCalled();
  });
});
