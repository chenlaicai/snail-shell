import { describe, it, expect, vi } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage } from "@domain/issue/model";
import type { StageTransitionSuggestion } from "@app/issue-collaboration/port";
import type { StageSuggestionRecord } from "@domain/issue/_internal/repository";

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

function makeSuggestion(overrides: Partial<StageTransitionSuggestion> = {}): StageTransitionSuggestion {
  return {
    stage_id: "s1",
    message_id: 1,
    from_speaker: "reviewer-1",
    target_key: "merge",
    reason: "ready",
    guard: null,
    artifacts: {},
    created_at: "2026-06-30T10:00:00.000Z",
    ...overrides,
  };
}

function createCollaboration() {
  return new IssueCollaboration({
    issuePort: createMockIssuePort(),
    createIssue: vi.fn(),
    stagePort: createMockStagePort(),
    messagePort: createMockMessagePort(),
    snailPort: createMockSnailPort(),
    liteAIPort: createMockLiteAIPort(),
    mcpMessageStore: createMockMcpMessageStore(),
    stageSuggestionRepo: createMockStageSuggestionRepo(),
  });
}

describe("dismissSuggestion", () => {
  it("should delete a specific suggestion by target_key + created_at and keep others", () => {
    const collab = createCollaboration();
    const s1 = makeSuggestion({ created_at: "2026-06-30T10:00:00.000Z", message_id: 1 });
    const s2 = makeSuggestion({ created_at: "2026-06-30T11:00:00.000Z", message_id: 2 });

    // Inject suggestions via detectStageTransition path (using private field)
    collab["suggestions"].set("s1", [s1, s2]);

    const result = collab.dismissSuggestion("s1", "merge", "2026-06-30T10:00:00.000Z");
    expect(result).toBe(true);

    const remaining = collab.listStageTransitionSuggestions("s1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].created_at).toBe("2026-06-30T11:00:00.000Z");
  });

  it("should clean up Map entry when last suggestion is dismissed", () => {
    const collab = createCollaboration();
    const s1 = makeSuggestion({ created_at: "2026-06-30T10:00:00.000Z" });
    collab["suggestions"].set("s1", [s1]);

    const result = collab.dismissSuggestion("s1", "merge", "2026-06-30T10:00:00.000Z");
    expect(result).toBe(true);
    expect(collab.listStageTransitionSuggestions("s1")).toHaveLength(0);
    expect(collab["suggestions"].has("s1")).toBe(false);
  });

  it("should return false when no suggestions exist for stageId", () => {
    const collab = createCollaboration();
    expect(collab.dismissSuggestion("nonexistent", "merge", "2026-06-30T10:00:00.000Z")).toBe(false);
  });

  it("should return false when target_key + created_at does not match", () => {
    const collab = createCollaboration();
    collab["suggestions"].set("s1", [makeSuggestion({ created_at: "2026-06-30T10:00:00.000Z" })]);

    expect(collab.dismissSuggestion("s1", "merge", "2026-06-30T99:00:00.000Z")).toBe(false);
  });

  it("should only dismiss matching created_at, not all suggestions with same target_key", () => {
    const collab = createCollaboration();
    const s1 = makeSuggestion({ from_speaker: "reviewer-1", created_at: "2026-06-30T10:00:00.000Z", message_id: 1 });
    const s2 = makeSuggestion({ from_speaker: "reviewer-2", created_at: "2026-06-30T11:00:00.000Z", message_id: 2 });
    collab["suggestions"].set("s1", [s1, s2]);

    collab.dismissSuggestion("s1", "merge", "2026-06-30T10:00:00.000Z");

    const remaining = collab.listStageTransitionSuggestions("s1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].from_speaker).toBe("reviewer-2");
  });
});

describe("listStageTransitionSuggestions dedup", () => {
  it("should deduplicate by target_key, keeping first occurrence", () => {
    const collab = createCollaboration();
    const s1 = makeSuggestion({ from_speaker: "reviewer-1", created_at: "2026-06-30T10:00:00.000Z", message_id: 1 });
    const s2 = makeSuggestion({ from_speaker: "reviewer-2", created_at: "2026-06-30T11:00:00.000Z", message_id: 2 });
    collab["suggestions"].set("s1", [s1, s2]);

    const result = collab.listStageTransitionSuggestions("s1");
    expect(result).toHaveLength(1);
    expect(result[0].from_speaker).toBe("reviewer-1");
  });

  it("should return empty array when no suggestions exist", () => {
    const collab = createCollaboration();
    expect(collab.listStageTransitionSuggestions("nonexistent")).toEqual([]);
  });
});

describe("advanceStage cleanup", () => {
  it("should clean up suggestions after advancing", async () => {
    const collab = createCollaboration();
    collab["suggestions"].set("s1", [makeSuggestion()]);
    (collab["deps"].stagePort.advanceStage as ReturnType<typeof vi.fn>).mockReturnValue(createStage({ id: "s2", key: "merge" }));

    await collab.advanceStage("s1", "merge");

    expect(collab["suggestions"].has("s1")).toBe(false);
  });
});

describe("acknowledgeSuggestion", () => {
  it("should mark suggestion as seen in DB and remove from memory", () => {
    const collab = createCollaboration();
    const s1 = makeSuggestion({ created_at: "2026-07-03T10:00:00.000Z", message_id: 42 });
    collab["suggestions"].set("s1", [s1]);

    const result = collab.acknowledgeSuggestion("s1", "merge", "2026-07-03T10:00:00.000Z");

    expect(result).toBe(true);
    expect(collab["deps"].stageSuggestionRepo.markSeen).toHaveBeenCalled();
    expect(collab["suggestions"].has("s1")).toBe(false);
  });

  it("should keep other suggestions in memory when acknowledging one", () => {
    const collab = createCollaboration();
    const s1 = makeSuggestion({ created_at: "2026-07-03T10:00:00.000Z", message_id: 1 });
    const s2 = makeSuggestion({ created_at: "2026-07-03T11:00:00.000Z", message_id: 2 });
    collab["suggestions"].set("s1", [s1, s2]);

    collab.acknowledgeSuggestion("s1", "merge", "2026-07-03T10:00:00.000Z");

    const remaining = collab.listStageTransitionSuggestions("s1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].created_at).toBe("2026-07-03T11:00:00.000Z");
  });

  it("should return false when no suggestions exist for stageId", () => {
    const collab = createCollaboration();
    expect(collab.acknowledgeSuggestion("nonexistent", "merge", "2026-07-03T10:00:00.000Z")).toBe(false);
  });

  it("should return false when target_key + created_at does not match", () => {
    const collab = createCollaboration();
    collab["suggestions"].set("s1", [makeSuggestion({ created_at: "2026-07-03T10:00:00.000Z" })]);

    expect(collab.acknowledgeSuggestion("s1", "merge", "2026-07-03T99:00:00.000Z")).toBe(false);
  });
});

describe("dismissSuggestion DB fallback", () => {
  it("should find suggestion in DB when not in memory (acknowledge removed it)", () => {
    const repo = createMockStageSuggestionRepo();
    const dbRecord: StageSuggestionRecord = {
      id: "42",
      stage_id: "s1",
      target_key: "merge",
      signal_type: null,
      gate_evidence: null,
      adversarial_artifact: null,
      decision_mode: null,
      recommendation: null,
      alternatives: null,
      status: "seen",
      created_at: new Date("2026-07-03T10:00:00.000Z").getTime(),
      processed_at: null,
    };
    repo.listActiveByStage = vi.fn().mockReturnValue([dbRecord]);
    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: repo,
    });

    const result = collab.dismissSuggestion("s1", "merge", "2026-07-03T10:00:00.000Z");

    expect(result).toBe(true);
    expect(repo.markProcessed).toHaveBeenCalled();
  });

  it("should return false when not in memory and not in DB", () => {
    const collab = createCollaboration();
    (collab["deps"].stageSuggestionRepo.listActiveByStage as ReturnType<typeof vi.fn>).mockReturnValue([]);

    expect(collab.dismissSuggestion("s1", "merge", "2026-07-03T10:00:00.000Z")).toBe(false);
  });
});

describe("advanceStage DB fallback", () => {
  it("should mark seen suggestions in DB as confirmed when memory is empty", async () => {
    const repo = createMockStageSuggestionRepo();
    const dbRecord: StageSuggestionRecord = {
      id: "42",
      stage_id: "s1",
      target_key: "merge",
      signal_type: null,
      gate_evidence: null,
      adversarial_artifact: null,
      decision_mode: null,
      recommendation: null,
      alternatives: null,
      status: "seen",
      created_at: new Date("2026-07-03T10:00:00.000Z").getTime(),
      processed_at: null,
    };
    repo.listActiveByStage = vi.fn().mockReturnValue([dbRecord]);
    const collab = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort: createMockStagePort(),
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: repo,
    });
    (collab["deps"].stagePort.advanceStage as ReturnType<typeof vi.fn>).mockReturnValue(createStage({ id: "s2", key: "merge" }));

    /** Memory is empty (suggestion was acknowledged), but DB has a seen record */
    await collab.advanceStage("s1", "merge");

    expect(repo.markProcessed).toHaveBeenCalled();
  });
});

describe("evaluateAdvance excludes seen suggestions", () => {
  it("should not restore seen suggestions from DB", async () => {
    const collab = createCollaboration();
    /** listPendingByStage returns only pending, not seen */
    (collab["deps"].stageSuggestionRepo.listPendingByStage as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (collab["deps"].stagePort.findStage as ReturnType<typeof vi.fn>).mockReturnValue(createStage());

    const result = await collab.evaluateAdvance("s1");

    expect(result.action).toBe("blocked");
    expect(collab["suggestions"].has("s1")).toBe(false);
  });
});
