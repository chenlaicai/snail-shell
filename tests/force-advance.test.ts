import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage, Issue } from "@domain/issue/model";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
import type { AutoAdvanceConfig, StageDefinition } from "@domain/sop/model";
import { Scope } from "@domain/workspace/model";

// ── Mock factories (same pattern as collaboration-kickoff.test.ts) ─────────

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
    invokeFirstCall: vi.fn().mockResolvedValue({ snail_instance_id: "test-instance" }),
    invokeResume: vi.fn(),
  };
}

function createMockLiteAIPort(): LiteAIPort {
  return {
    getConfig: vi.fn(),
    chat: vi.fn(),
  };
}

// ── Test data ─────────────────────────────────────────────────────────────

const DEVELOPMENT_CONFIG: AutoAdvanceConfig = {
  required_context_fields: ["worktree_path", "branch_name", "pr_url"],
  gate_ids: ["dev-01", "dev-02", "dev-03", "dev-04", "dev-06"],
  accepted_signal_types: ["gate_complete"],
};

function makeStageDef(key: string, config?: AutoAdvanceConfig): StageDefinition {
  return { key, title: key, description: "", roles: [], auto_advance: config };
}

const ALL_STAGE_DEFS: StageDefinition[] = [
  makeStageDef("design", DEVELOPMENT_CONFIG),
  makeStageDef("development"),
  makeStageDef("review"),
  makeStageDef("merge"),
];

function createStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    workspace_path: "/workspace",
    issue_id: "issue-1",
    key: "development",
    title: "Development",
    description: "",
    default_role_instance: "dev",
    role_instances: ["dev"],
    from_stage_id: null,
    available_transitions: [{ to: "review", guard: null }],
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
    sop_snapshot: { key: "test", name: "Test SOP", description: null, shared_skill: null, stage_definitions: ALL_STAGE_DEFS, transitions: [], scope: Scope.Workspace },
    snail_assignment_plan: {},
    context: { worktree_path: "/wt", branch_name: "test", pr_url: "https://github.com/test/test/pull/1" },
    created_at: new Date().toISOString(),
    closed_at: null,
    close_summary: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("forceAdvance", () => {
  let auditRecords: Array<{ stage_id: string; from_key: string; to_key: string; trigger: string; trigger_reason: string }>;
  let advanceStageSpy: ReturnType<typeof vi.fn>;
  let newStage: Stage;

  beforeEach(() => {
    newStage = createStage({ id: "stage-2", key: "review", title: "Review", from_stage_id: "stage-1" });
    auditRecords = [];
    advanceStageSpy = vi.fn().mockReturnValue(newStage);
  });

  function createCollaboration(opts: { issuePort?: IssuePort; stagePort?: StagePort } = {}) {
    const oldStage = createStage();
    const issuePort = opts.issuePort ?? createMockIssuePort({
      findIssue: vi.fn().mockReturnValue(createOpenIssue()),
    });
    const stagePort = opts.stagePort ?? createMockStagePort({
      findStage: vi.fn().mockReturnValue(oldStage),
      advanceStage: advanceStageSpy as unknown as StagePort["advanceStage"],
      recordAudit: vi.fn((record: typeof auditRecords[number]) => { auditRecords.push(record); }),
      getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: null, role_key: "developer" }),
    });

    return new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort,
      messagePort: createMockMessagePort(),
      snailPort: createMockSnailPort(),
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });
  }

  it("正常强制推进：evaluateAdvance 返回 blocked → forceAdvance 仍推进", async () => {
    const collaboration = createCollaboration();

    const result = await collaboration.forceAdvance("stage-1", "review");

    /** 返回的 stage 是 advanceStage 的返回值，证明推进已执行 */
    expect(result.stage).toBe(newStage);
    expect(result.evaluation.action).toBe("blocked");
    /** evaluation 包含阻断原因，供前端展示 */
    expect(result.evaluation.reasons.length).toBeGreaterThan(0);
  });

  it("审计日志写入 forced 标记", async () => {
    const collaboration = createCollaboration();

    await collaboration.forceAdvance("stage-1", "review");

    /** 通过 auditRecords 副作用验证审计日志内容 */
    expect(auditRecords).toHaveLength(1);
    expect(auditRecords[0].trigger).toBe("manual");
    expect(auditRecords[0].trigger_reason).toContain("[forced]");
    expect(auditRecords[0].trigger_reason).toContain("用户强制推进");
    expect(auditRecords[0].from_key).toBe("development");
    expect(auditRecords[0].to_key).toBe("review");
  });

  it("消费者收到 onAutoAdvanced 通知", async () => {
    const collaboration = createCollaboration();
    let notified = false;
    collaboration.registerIssueConsumer("issue-1", {
      onEvent: () => {},
      onMessageCompleted: () => {},
      onUserCalled: () => {},
      onAutoAdvanced: () => { notified = true; },
    });

    await collaboration.forceAdvance("stage-1", "review");
    /** onAutoAdvanced 是异步通知，等待微任务 */
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(notified).toBe(true);
  });

  it("evaluateAdvance 抛异常时 forceAdvance 仍推进，返回 fallback evaluation", async () => {
    const collaboration = createCollaboration();
    /** 直接 mock evaluateAdvance 方法抛异常 */
    vi.spyOn(collaboration, "evaluateAdvance").mockRejectedValueOnce(new Error("DB connection lost"));

    const result = await collaboration.forceAdvance("stage-1", "review");

    /** 返回的 stage 是 advanceStage 的返回值，证明推进已执行 */
    expect(result.stage).toBe(newStage);
    expect(result.evaluation.action).toBe("blocked");
    expect(result.evaluation.reasons[0].code).toBe("EVALUATE_FAILED");
  });
});
