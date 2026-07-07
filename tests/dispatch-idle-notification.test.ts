import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage, Issue } from "@domain/issue/model";
import type { StageSuggestionRepository } from "@domain/issue/_internal/repository";
import type { WorkspaceConsumer } from "@app/issue-collaboration/port";
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
  return { insert: vi.fn(), listPendingByStage: vi.fn().mockReturnValue([]), listActiveByStage: vi.fn().mockReturnValue([]), countIgnoredByStageAndTargetKey: vi.fn().mockReturnValue(0), markSeen: vi.fn(), markProcessed: vi.fn(), deleteByStage: vi.fn() };
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

function createStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "s1",
    workspace_path: "/workspace",
    issue_id: "issue-1",
    key: "development",
    title: "Development",
    description: "",
    default_role_instance: "developer",
    role_instances: ["developer"],
    from_stage_id: null,
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

describe("dispatch idle → workspace notification", () => {
  let invokeFirstCallSpy: ReturnType<typeof vi.fn>;
  let nextMessageId: number;
  let messageStore: Map<number, { id: number; stage_id: string; from_speaker: string; to_speakers: string[]; status: "completed" | "streaming" | "failed"; created_at: string; ended_at: null }>;

  beforeEach(() => {
    nextMessageId = 100;
    messageStore = new Map();
    messageStore.set(1, { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["developer"], status: "completed" as const, created_at: "", ended_at: null });
    invokeFirstCallSpy = vi.fn().mockResolvedValue({ snail_instance_id: "test-instance" });
  });

  function createCollaboration() {
    const stage = createStage();
    const issue = createOpenIssue();
    const createMessageSpy = vi.fn().mockImplementation((input: { stage_id: string; from_speaker: string; to_speakers: string[]; status: "completed" | "streaming" | "failed" }) => {
      const id = nextMessageId++;
      const msg = { id, ...input, created_at: "", ended_at: null };
      messageStore.set(id, msg);
      return msg;
    });

    const messagePort = createMockMessagePort({
      createMessage: createMessageSpy as unknown as MessagePort["createMessage"],
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
      findLatestMessage: () => ({ id: 1, stage_id: "s1", from_speaker: "user", to_speakers: [], status: "completed" as const, created_at: "", ended_at: null }),
    });

    const issuePort = createMockIssuePort({
      findIssue: vi.fn().mockReturnValue(issue),
    });

    const stagePort = createMockStagePort({
      findStage: vi.fn().mockReturnValue(stage),
      getRoleSnailAssignment: vi.fn().mockReturnValue({ snail_key: "test-snail", snail_instance_id: null, role_key: "developer" }),
    });

    const snailPort = {
      ...createMockSnailPort(),
      invokeFirstCall: invokeFirstCallSpy as unknown as SnailPort["invokeFirstCall"],
    };

    const collaboration = new IssueCollaboration({
      issuePort,
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
      stageSuggestionRepo: createMockStageSuggestionRepo(),
    });

    return { collaboration, issue };
  }

  it("dispatch idle 后通知 workspace consumers 状态变为 needs_human", async () => {
    const { collaboration, issue } = createCollaboration();

    const statusChanges: { issueId: string; newStatus: string; prevStatus: string }[] = [];
    const consumer: WorkspaceConsumer = {
      onActivityStatusChanged: (issueId, newStatus, prevStatus) => {
        statusChanges.push({ issueId, newStatus, prevStatus });
      },
    };
    collaboration.registerWorkspaceConsumer(issue.workspace_path, consumer);

    await collaboration.sendMessage("s1", "hello", "user", ["developer"]);
    await new Promise(resolve => setTimeout(resolve, 50));

    const needsHuman = statusChanges.find(s => s.newStatus === "needs_human");
    expect(needsHuman).toBeDefined();
    expect(needsHuman!.issueId).toBe(issue.id);
  });

  it("dispatch idle 通知仅在状态变化时触发（幂等）", async () => {
    const { collaboration, issue } = createCollaboration();

    const statusChanges: { issueId: string; newStatus: string; prevStatus: string }[] = [];
    const consumer: WorkspaceConsumer = {
      onActivityStatusChanged: (issueId, newStatus, prevStatus) => {
        statusChanges.push({ issueId, newStatus, prevStatus });
      },
    };
    collaboration.registerWorkspaceConsumer(issue.workspace_path, consumer);

    await collaboration.sendMessage("s1", "hello", "user", ["developer"]);
    await new Promise(resolve => setTimeout(resolve, 50));

    /** 所有通知中不应有连续相同状态 */
    for (let i = 1; i < statusChanges.length; i++) {
      expect(statusChanges[i].newStatus).not.toBe(statusChanges[i - 1].newStatus);
    }
  });

  it("invokeAgent 抛异常时 finally 块仍触发 workspace 通知", async () => {
    const { collaboration, issue } = createCollaboration();

    /** 让 invokeFirstCall 抛出异常 */
    invokeFirstCallSpy.mockRejectedValue(new Error("agent crashed"));

    const statusChanges: { issueId: string; newStatus: string; prevStatus: string }[] = [];
    const consumer: WorkspaceConsumer = {
      onActivityStatusChanged: (issueId, newStatus, prevStatus) => {
        statusChanges.push({ issueId, newStatus, prevStatus });
      },
    };
    collaboration.registerWorkspaceConsumer(issue.workspace_path, consumer);

    /** sendMessage 会触发 dispatch → invokeAgent，异常不应阻止 finally 块 */
    await collaboration.sendMessage("s1", "hello", "user", ["developer"]);
    await new Promise(resolve => setTimeout(resolve, 100));

    /** 即使 invokeAgent 失败，finally 块应将状态从 ai_running 恢复为 needs_human */
    const aiRunningToNeedsHuman = statusChanges.find(s => s.newStatus === "needs_human" && s.prevStatus === "ai_running");
    expect(aiRunningToNeedsHuman).toBeDefined();
    expect(aiRunningToNeedsHuman!.issueId).toBe(issue.id);
  });
});
