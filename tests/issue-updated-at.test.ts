import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIssueRoutes } from "@adapter/http/routes/issue.route";
import { encodeWorkspaceId } from "@adapter/http/workspace-id";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { WorkspacePort } from "@domain/workspace/port";
import type { CollaborationPort } from "@domain/collaboration/port";
import type { Issue, Stage } from "@domain/issue/model";
import type { Message } from "@domain/message/model";
import type { Workspace } from "@domain/workspace/model";
import { Scope } from "@domain/workspace/model";

const ISSUE_CREATED_AT = "2026-01-01T00:00:00.000Z";
const MESSAGE_CREATED_AT = "2026-01-02T10:00:00.000Z";
const MESSAGE_ENDED_AT = "2026-01-02T10:05:00.000Z";

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Test Issue",
    summary: null,
    workspace_path: "/workspace",
    context: {},
    snail_assignment_plan: {},
    sop_snapshot: {
      key: "test-sop",
      name: "Test SOP",
      description: null,
      stage_definitions: [],
      transitions: [],
      shared_skill: null,
      scope: Scope.Platform,
    },
    created_at: ISSUE_CREATED_AT,
    closed_at: null,
    close_summary: null,
    ...overrides,
  };
}

function createStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    workspace_path: "/workspace",
    issue_id: "issue-1",
    key: "design",
    title: "Design",
    description: "",
    default_role_instance: "architect",
    role_instances: ["architect"],
    from_stage_id: null,
    available_transitions: [],
    output_artifacts: {},
    entered_at: ISSUE_CREATED_AT,
    left_at: null,
    ...overrides,
  };
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    stage_id: "stage-1",
    from_speaker: "user",
    to_speakers: [],
    status: "completed",
    created_at: MESSAGE_CREATED_AT,
    ended_at: MESSAGE_ENDED_AT,
    ...overrides,
  };
}

function createMockDeps(options: {
  issue?: Issue;
  latestMessage?: Message | undefined;
} = {}) {
  const issue = options.issue ?? createIssue();
  const stage = createStage({ issue_id: issue.id });

  const issuePort: IssuePort = {
    findIssue: vi.fn().mockReturnValue(issue),
    listIssues: vi.fn().mockReturnValue([issue]),
    previewSopStages: vi.fn(),
    validateSnailAssignmentPlan: vi.fn(),
    updateContext: vi.fn(),
    closeIssue: vi.fn(),
    updateCloseSummary: vi.fn(),
  };

  const stagePort: StagePort = {
    findStage: vi.fn().mockReturnValue(stage),
    listStages: vi.fn().mockReturnValue([stage]),
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
    getRoleSnailAssignments: vi.fn().mockReturnValue([]),
    getRoleSnailAssignment: vi.fn(),
  };

  const messagePort: MessagePort = {
    createMessage: vi.fn(),
    getMessage: vi.fn(),
    listMessages: vi.fn(),
    listMessagesWindow: vi.fn(),
    searchByFts: () => [],
    searchContext: vi.fn(),
    listMessagesByStatus: vi.fn(),
    updateMessageTargets: vi.fn(),
    completeMessage: vi.fn(),
    appendEvent: vi.fn(),
    getMessageEvents: vi.fn(),
    getContext: vi.fn(),
    setContext: vi.fn(),
    getCursor: vi.fn(),
    advanceCursor: vi.fn(),
    getUnreadMessages: vi.fn(),
    initCursor: vi.fn(),
    findLatestRespondingSpeaker: vi.fn(),
    findLatestMessage: vi.fn(),
    findLatestMessageBySpeaker: vi.fn(),
    findLatestMessageByIssueId: vi.fn().mockReturnValue(options.latestMessage),
  };

  const workspacePort: WorkspacePort = {
    list: vi.fn().mockReturnValue([{ path: "/workspace", summary: null }] as Workspace[]),
    add: vi.fn(),
  };

  const collaboration: CollaborationPort = {
    createIssue: vi.fn(),
    sendMessage: vi.fn(),
    interruptMessage: vi.fn(),
    registerIssueConsumer: vi.fn(),
    unregisterIssueConsumer: vi.fn(),
    registerWorkspaceConsumer: vi.fn(),
    unregisterWorkspaceConsumer: vi.fn(),
    listStageTransitionSuggestions: vi.fn().mockReturnValue([]),
    dismissSuggestion: vi.fn(),
    acknowledgeSuggestion: vi.fn(),
    advanceStage: vi.fn(),
    forceAdvance: vi.fn(),
    evaluateAdvance: vi.fn(),
    rollbackStage: vi.fn(),
    getStageAuditTrail: vi.fn(),
    closeIssue: vi.fn(),
    isInvoking: vi.fn().mockReturnValue(false),
    getActivityStatus: vi.fn().mockReturnValue("completed"),
    resumeRoute: vi.fn(),
  };

  return { issuePort, stagePort, messagePort, workspacePort, collaboration, issue };
}

describe("toIssueDetail updated_at calculation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 验收标准：updated_at = 最新消息的 ended_at */
  it("uses latest message ended_at when message is completed", async () => {
    const msg = createMessage({ ended_at: MESSAGE_ENDED_AT });
    const deps = createMockDeps({ latestMessage: msg });
    const app = createIssueRoutes(deps);

    const res = await app.request(`/api/issues/issue-1`);
    const body = await res.json() as { updated_at: string };

    expect(body.updated_at).toBe(MESSAGE_ENDED_AT);
  });

  /** 验收标准：若 ended_at 为 null（streaming 中），则 = 最新消息的 created_at */
  it("falls back to message created_at when ended_at is null (streaming)", async () => {
    const msg = createMessage({ ended_at: null, status: "streaming" });
    const deps = createMockDeps({ latestMessage: msg });
    const app = createIssueRoutes(deps);

    const res = await app.request(`/api/issues/issue-1`);
    const body = await res.json() as { updated_at: string };

    expect(body.updated_at).toBe(MESSAGE_CREATED_AT);
  });

  /** 验收标准：Issue 无消息时，updated_at = issue.created_at */
  it("falls back to issue.created_at when no messages exist", async () => {
    const deps = createMockDeps({ latestMessage: undefined });
    const app = createIssueRoutes(deps);

    const res = await app.request(`/api/issues/issue-1`);
    const body = await res.json() as { updated_at: string };

    expect(body.updated_at).toBe(ISSUE_CREATED_AT);
  });

  /** issues list 端点也正确返回 updated_at */
  it("workspace issues list returns updated_at for each issue", async () => {
    const msg = createMessage({ ended_at: MESSAGE_ENDED_AT });
    const deps = createMockDeps({ latestMessage: msg });
    const app = createIssueRoutes(deps);

    const workspaceId = encodeWorkspaceId("/workspace");
    const res = await app.request(`/api/workspaces/${workspaceId}/issues`);
    const body = await res.json() as Array<{ updated_at: string }>;

    expect(body).toHaveLength(1);
    expect(body[0].updated_at).toBe(MESSAGE_ENDED_AT);
  });
});
