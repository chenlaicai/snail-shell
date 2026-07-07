import { describe, it, expect, vi } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
import type { Message, MessageEvent } from "@domain/message/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage } from "@domain/issue/model";
import { createStageTransitionServer } from "@domain/snail-mcp-server/_internal/servers/snail-stage-transition";
import type { StageTransitionPort } from "@domain/snail-mcp-server/port";

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

describe("request_stage_transition MCP tool", () => {
  it("should register signal when validation passes", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const messagePort = createMockMessagePort({
      findLatestMessageBySpeaker: () => messages.get(100),
    });

    const stageSuggestionRepo = createMockStageSuggestionRepo();
    const stagePort = createMockStagePort();
    (stagePort.findStage as ReturnType<typeof vi.fn>).mockReturnValue(createStage());

    const issuePort = createMockIssuePort();
    (issuePort.findIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "issue-1", workspace_path: "/workspace", title: "Test", summary: null,
      context: { pr_url: "https://github.com/pr/1", feature_number: "F20260701tj92" },
      sop_snapshot: { stage_definitions: [
        { key: "review", title: "Review", description: "", roles: [], auto_advance: {
          required_context_fields: ["pr_url"],
          gate_ids: ["rev-04"],
          accepted_signal_types: ["adversarial_consensus"],
          blocking_rules: [],
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

    const server = createStageTransitionServer(collaboration as unknown as StageTransitionPort);
    const handler = server.tools[0].handler;

    const result = await handler({
      stage_id: "s1",
      target_key: "merge",
      reason: "Review complete",
      from_speaker: "reviewer-1",
    });

    expect(result).toEqual({ valid: true, registered: true });
    expect(stageSuggestionRepo.insert).toHaveBeenCalled();
  });

  it("should return valid=false when context field is missing", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const messagePort = createMockMessagePort({
      findLatestMessageBySpeaker: () => messages.get(100),
    });

    const stageSuggestionRepo = createMockStageSuggestionRepo();
    const stagePort = createMockStagePort();
    (stagePort.findStage as ReturnType<typeof vi.fn>).mockReturnValue(createStage());

    const issuePort = createMockIssuePort();
    (issuePort.findIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "issue-1", workspace_path: "/workspace", title: "Test", summary: null,
      context: {},
      sop_snapshot: { stage_definitions: [
        { key: "review", title: "Review", description: "", roles: [], auto_advance: {
          required_context_fields: ["pr_url"],
          gate_ids: ["rev-04"],
          accepted_signal_types: ["adversarial_consensus"],
          blocking_rules: [],
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

    const server = createStageTransitionServer(collaboration as unknown as StageTransitionPort);
    const handler = server.tools[0].handler;

    const result = await handler({
      stage_id: "s1",
      target_key: "merge",
      reason: "Review complete",
      from_speaker: "reviewer-1",
    }) as { valid: false; reasons: { code: string }[] };

    expect(result.valid).toBe(false);
    expect(result.reasons[0].code).toBe("CONTEXT_MISSING");
    expect(stageSuggestionRepo.insert).not.toHaveBeenCalled();
  });

  it("should return valid=false when rev-04 feature_number is missing", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const messagePort = createMockMessagePort({
      findLatestMessageBySpeaker: () => messages.get(100),
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
          gate_ids: ["rev-04"],
          accepted_signal_types: ["adversarial_consensus"],
          blocking_rules: [],
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

    const server = createStageTransitionServer(collaboration as unknown as StageTransitionPort);
    const handler = server.tools[0].handler;

    const result = await handler({
      stage_id: "s1",
      target_key: "merge",
      reason: "Review complete",
      from_speaker: "reviewer-1",
    }) as { valid: false; reasons: { code: string }[] };

    expect(result.valid).toBe(false);
    expect(result.reasons[0].code).toBe("GATE_FAILED");
    expect(stageSuggestionRepo.insert).not.toHaveBeenCalled();
  });
});

describe("B5: set_final_body without request_stage_transition (no signal)", () => {
  it("should not trigger auto-advance when agent only calls set_final_body", async () => {
    const messages = new Map<number, Message>();
    messages.set(300, { id: 300, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const events: MessageEvent[] = [];
    const messagePort = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(300),
      appendEvent: (_messageId, payload) => {
        const event: MessageEvent = { id: events.length + 1, message_id: 300, seq: events.length + 1, payload, created_at: "" };
        events.push(event);
        return event;
      },
      getMessageEvents: () => events,
    });

    const stageSuggestionRepo = createMockStageSuggestionRepo();
    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort,
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo,
    });

    // Agent only calls set_final_body without request_stage_transition
    // No signal should be registered
    expect(stageSuggestionRepo.insert).not.toHaveBeenCalled();
    // No suggestions in memory
    expect(collaboration.listStageTransitionSuggestions("s1")).toHaveLength(0);
  });
});
