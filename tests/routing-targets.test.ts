import { describe, it, expect, vi } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import { CONTEXT_KEYS } from "@infra/acs/context-keys";
import { Scope } from "@domain/workspace/model";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { Message } from "@domain/message/model";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Stage, Issue } from "@domain/issue/model";
import type { SnailFirstCallRequest } from "@domain/snail/model";

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
    default_role_instance: "reviewer-1",
    role_instances: ["reviewer-1", "reviewer-2", "developer-1"],
    from_stage_id: null,
    available_transitions: [{ to: "merge", guard: null }],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Test Issue",
    summary: "Test summary",
    workspace_path: "/workspace",
    context: {},
    snail_assignment_plan: {},
    sop_snapshot: {
      key: "test-sop",
      name: "Test SOP",
      description: "Test SOP description",
      stage_definitions: [
        {
          key: "review",
          title: "Review",
          description: "Review stage",
          roles: [
            { key: "reviewer", name: "审查者", description: "审查者角色", is_primary: false, count: 2, skill: "cd-review", prohibition: null, self_check: null },
            { key: "developer", name: "开发者", description: "开发者角色", is_primary: false, count: 1, skill: "cd-review-dev", prohibition: null, self_check: null },
          ],
        },
      ],
      shared_skill: "cd-shared",
      transitions: [{ from: "review", to: "merge", guard: null }],
      scope: Scope.Platform,
    },
    closed_at: null,
    close_summary: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildContextBlock routing targets", () => {
  it("should include available routing targets excluding self in system prompt", async () => {
    // Arrange
    let capturedRequest: SnailFirstCallRequest | undefined;
    const snailPort: SnailPort = {
      list: vi.fn(),
      findByKey: vi.fn().mockReturnValue({ key: "test-snail", name: "Test Snail", agent_name: "claude-code", model: "test" }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      invokeFirstCall: vi.fn().mockImplementation(async (_key: string, request: SnailFirstCallRequest) => {
        capturedRequest = request;
        return { snail_instance_id: "instance-1" };
      }),
      invokeResume: vi.fn(),
    };

    const stage = createStage();
    const stagePort = createMockStagePort();
    stagePort.findStage = vi.fn().mockReturnValue(stage);
    stagePort.getRoleSnailAssignment = vi.fn().mockReturnValue({
      snail_key: "test-snail",
      snail_instance_id: null,
      role_key: "reviewer",
    });

    const agentMessage: Message = { id: 1, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null };
    const messagePort = createMockMessagePort({
      createMessage: vi.fn().mockReturnValue(agentMessage),
      getMessage: vi.fn().mockReturnValue(agentMessage),
      getUnreadMessages: vi.fn().mockReturnValue([
        { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["reviewer-1"], status: "completed", created_at: "", ended_at: null },
      ]),
    });

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });

    // Mock the issue port to return our test issue
    const issue = createIssue();
    collaboration["deps"].issuePort.findIssue = vi.fn().mockReturnValue(issue);

    // Act - trigger an agent invocation
    await collaboration["invokeAgent"]("s1", "reviewer-1", [
      { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["reviewer-1"], status: "completed", created_at: "", ended_at: null },
    ]);

    // Assert
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.systemReminder).toBeDefined();

    // Verify routing targets are included in system prompt
    const systemReminder = capturedRequest!.systemReminder!;

    // Should include available routing targets (excluding self "reviewer-1")
    expect(systemReminder).toContain("**可用路由目标**");
    expect(systemReminder).toContain("`user`");
    expect(systemReminder).toContain("`reviewer-2`");
    expect(systemReminder).toContain("`developer-1`");

    // Should NOT include self (reviewer-1)
    expect(systemReminder).not.toContain("`reviewer-1`");

    // Should include format requirement
    expect(systemReminder).toContain("**格式要求**");
    expect(systemReminder).toContain("不要使用 snail key（如 claude-code-stateful）");
  });

  it("should include all role instances when roleInstance is not in stage", async () => {
    // Arrange
    let capturedRequest: SnailFirstCallRequest | undefined;
    const snailPort: SnailPort = {
      list: vi.fn(),
      findByKey: vi.fn().mockReturnValue({ key: "test-snail", name: "Test Snail", agent_name: "claude-code", model: "test" }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      invokeFirstCall: vi.fn().mockImplementation(async (_key: string, request: SnailFirstCallRequest) => {
        capturedRequest = request;
        return { snail_instance_id: "instance-1" };
      }),
      invokeResume: vi.fn(),
    };

    const stage = createStage();
    const stagePort = createMockStagePort();
    stagePort.findStage = vi.fn().mockReturnValue(stage);
    stagePort.getRoleSnailAssignment = vi.fn().mockReturnValue({
      snail_key: "test-snail",
      snail_instance_id: null,
      role_key: "reviewer",
    });

    const agentMessage: Message = { id: 2, stage_id: "s1", from_speaker: "observer", to_speakers: [], status: "streaming", created_at: "", ended_at: null };
    const messagePort = createMockMessagePort({
      createMessage: vi.fn().mockReturnValue(agentMessage),
      getMessage: vi.fn().mockReturnValue(agentMessage),
      getUnreadMessages: vi.fn().mockReturnValue([
        { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["observer"], status: "completed", created_at: "", ended_at: null },
      ]),
    });

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });

    // Mock the issue port to return our test issue
    const issue = createIssue();
    collaboration["deps"].issuePort.findIssue = vi.fn().mockReturnValue(issue);

    // Act - trigger an agent invocation with a roleInstance that's not in stage
    await collaboration["invokeAgent"]("s1", "observer", [
      { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["observer"], status: "completed", created_at: "", ended_at: null },
    ]);

    // Assert
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.systemReminder).toBeDefined();

    const systemReminder = capturedRequest!.systemReminder!;

    // Should include all role instances (since observer is not in stage, no exclusion)
    expect(systemReminder).toContain("**可用路由目标**");
    expect(systemReminder).toContain("`user`");
    expect(systemReminder).toContain("`reviewer-1`");
    expect(systemReminder).toContain("`reviewer-2`");
    expect(systemReminder).toContain("`developer-1`");
  });
});

describe("executeAgentInvocation CONTEXT_KEYS usage", () => {
  it("should use CONTEXT_KEYS constants in first-call context", async () => {
    // Arrange
    let capturedRequest: SnailFirstCallRequest | undefined;
    const snailPort: SnailPort = {
      list: vi.fn(),
      findByKey: vi.fn().mockReturnValue({ key: "test-snail", name: "Test Snail", agent_name: "claude-code", model: "test" }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      invokeFirstCall: vi.fn().mockImplementation(async (_key: string, request: SnailFirstCallRequest) => {
        capturedRequest = request;
        return { snail_instance_id: "instance-1" };
      }),
      invokeResume: vi.fn(),
    };

    const stage = createStage();
    const stagePort = createMockStagePort();
    stagePort.findStage = vi.fn().mockReturnValue(stage);
    stagePort.getRoleSnailAssignment = vi.fn().mockReturnValue({
      snail_key: "test-snail",
      snail_instance_id: null,
      role_key: "reviewer",
    });

    const agentMessage: Message = { id: 100, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null };
    const messagePort = createMockMessagePort({
      createMessage: vi.fn().mockReturnValue(agentMessage),
      getMessage: vi.fn().mockReturnValue(agentMessage),
      getUnreadMessages: vi.fn().mockReturnValue([
        { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["reviewer-1"], status: "completed", created_at: "", ended_at: null },
      ]),
    });

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });

    // Mock the issue port to return our test issue
    const issue = createIssue();
    collaboration["deps"].issuePort.findIssue = vi.fn().mockReturnValue(issue);

    // Act - trigger an agent invocation
    await collaboration["invokeAgent"]("s1", "reviewer-1", [
      { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["reviewer-1"], status: "completed", created_at: "", ended_at: null },
    ]);

    // Assert
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.context).toBeDefined();

    const context = capturedRequest!.context!;
    const systemContext = capturedRequest!.systemContext!;

    // 系统标识符在 systemContext 中（方案 C：分离系统标识符和业务数据）
    expect(systemContext).toHaveProperty(CONTEXT_KEYS.ISSUE_ID);
    expect(systemContext).toHaveProperty(CONTEXT_KEYS.STAGE_ID);
    expect(systemContext).toHaveProperty(CONTEXT_KEYS.MESSAGE_ID);
    expect(systemContext[CONTEXT_KEYS.ISSUE_ID]).toBe("issue-1");
    expect(systemContext[CONTEXT_KEYS.STAGE_ID]).toBe("s1");
    expect(systemContext[CONTEXT_KEYS.MESSAGE_ID]).toBe("100");

    // 业务数据在 context 中
    expect(context).toHaveProperty("stage_key", "review");
    expect(context).toHaveProperty("role_instance", "reviewer-1");
    expect(context).toHaveProperty("snail_key", "test-snail");
    // 系统标识符不应出现在业务 context 中
    expect(context).not.toHaveProperty(CONTEXT_KEYS.ISSUE_ID);
  });

  it("should use CONTEXT_KEYS constants in resume context", async () => {
    // Arrange
    let capturedInstanceId: string | undefined;
    let capturedRequest: any;
    const snailPort: SnailPort = {
      list: vi.fn(),
      findByKey: vi.fn().mockReturnValue({ key: "test-snail", name: "Test Snail", agent_name: "claude-code", model: "test" }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      invokeFirstCall: vi.fn(),
      invokeResume: vi.fn().mockImplementation(async (instanceId: string, request: any) => {
        capturedInstanceId = instanceId;
        capturedRequest = request;
        return { snail_instance_id: instanceId };
      }),
    };

    const stage = createStage();
    const stagePort = createMockStagePort();
    stagePort.findStage = vi.fn().mockReturnValue(stage);
    stagePort.getRoleSnailAssignment = vi.fn().mockReturnValue({
      snail_key: "test-snail",
      snail_instance_id: "instance-1",
      role_key: "reviewer",
    });

    const agentMessage: Message = { id: 100, stage_id: "s1", from_speaker: "reviewer-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null };
    const messagePort = createMockMessagePort({
      createMessage: vi.fn().mockReturnValue(agentMessage),
      getMessage: vi.fn().mockReturnValue(agentMessage),
      getUnreadMessages: vi.fn().mockReturnValue([
        { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["reviewer-1"], status: "completed", created_at: "", ended_at: null },
      ]),
    });

    const collaboration = new IssueCollaboration({
      issuePort: createMockIssuePort(),
      createIssue: vi.fn(),
      stagePort,
      messagePort,
      snailPort,
      liteAIPort: createMockLiteAIPort(),
      mcpMessageStore: createMockMcpMessageStore(),
    });

    // Mock the issue port to return our test issue
    const issue = createIssue();
    collaboration["deps"].issuePort.findIssue = vi.fn().mockReturnValue(issue);

    // Act - trigger an agent invocation (resume path)
    await collaboration["invokeAgent"]("s1", "reviewer-1", [
      { id: 1, stage_id: "s1", from_speaker: "user", to_speakers: ["reviewer-1"], status: "completed", created_at: "", ended_at: null },
    ]);

    // Assert
    expect(capturedInstanceId).toBe("instance-1");
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest.messageId).toBe("100");
    expect(capturedRequest.stageId).toBe("s1");

    // 业务数据在 context 中（与 firstCall 路径一致）
    const context = capturedRequest.context;
    expect(context).toBeDefined();
    expect(context).toHaveProperty("stage_key", "review");
    expect(context).toHaveProperty("role_instance", "reviewer-1");
    expect(context).toHaveProperty("snail_key", "test-snail");
    expect(context).not.toHaveProperty(CONTEXT_KEYS.ISSUE_ID);
  });
});
