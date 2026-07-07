import { describe, it, expect } from "vitest";
import { createFinalResponseServer } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { Message, MessageEvent, MessageEventPayload } from "@domain/message/model";

function createMockStagePort(overrides: Partial<StagePort> = {}): StagePort {
  return {
    findStage: () => undefined,
    listStages: () => [],
    listOpenStageIds: () => [],
    listAllOpenStageIds: () => [],
    previewStage: () => ({ key: "", title: "", description: "", available_transitions: [], role_instances: [] }),
    getStageSnailAssignmentPlan: () => ({}),
    transaction: (fn) => fn(),
    createStage: () => ({ id: "", workspace_path: "", issue_id: "", key: "", title: "", description: "", default_role_instance: "", role_instances: [], from_stage_id: null, available_transitions: [], output_artifacts: {}, entered_at: "", left_at: null }),
    addOutputArtifacts: () => {},
    advanceStage: () => ({ id: "", workspace_path: "", issue_id: "", key: "", title: "", description: "", default_role_instance: "", role_instances: [], from_stage_id: null, available_transitions: [], output_artifacts: {}, entered_at: "", left_at: null }),
    rollbackStage: () => ({ id: "", workspace_path: "", issue_id: "", key: "", title: "", description: "", default_role_instance: "", role_instances: [], from_stage_id: null, available_transitions: [], output_artifacts: {}, entered_at: "", left_at: null }),
    recordAudit: () => {},
    getAuditTrail: () => [],
    switchSnail: () => {},
    setSnailInstanceId: () => {},
    getRoleSnailAssignments: () => [],
    getRoleSnailAssignment: () => null,
    ...overrides,
  };
}

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

describe("set_final_body handler", () => {
  it("writes mcp_final_body when message_id matches stage_id", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let writtenId: number | undefined;
    let writtenKind: string | undefined;
    let writtenCtx: string | undefined;

    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
      setContext: (id, kind, ctx) => { writtenId = id; writtenKind = kind; writtenCtx = ctx; },
    });

    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "dev" });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(writtenId).toBe(100);
    expect(writtenKind).toBe("mcp_final_body");
    expect(writtenCtx).toBe("hello");
  });

  it("rejects when message_id does not belong to stage_id", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
    });

    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-b", from_speaker: "dev" }))
      .rejects.toThrow("message_id 100 does not belong to stage stage-b (actual: stage-a)");
  });

  it("rejects when message_id does not exist", async () => {
    const port = createMockMessagePort({
      getMessage: () => undefined,
    });

    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "999", stage_id: "stage-a", from_speaker: "dev" }))
      .rejects.toThrow("message_id 999 not found");
  });

  it("skips stage validation when stage_id is not provided", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let writtenId: number | undefined;

    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      setContext: (id) => { writtenId = id; },
    });

    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", from_speaker: "dev" });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(writtenId).toBe(100);
  });

  it("rejects empty text", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "" }))
      .rejects.toThrow("text is required");
  });

  it("rejects non-positive message_id", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "0", stage_id: "stage-a", from_speaker: "dev" }))
      .rejects.toThrow("message_id must be a positive integer");
  });

  it("rejects non-integer message_id", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "abc", stage_id: "stage-a", from_speaker: "dev" }))
      .rejects.toThrow("message_id must be a positive integer");
  });

  it("rejects missing from_speaker", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-a" }))
      .rejects.toThrow("from_speaker is required");
  });
});

describe("set_final_body speaker ownership (B-1, B-3)", () => {
  it("B-3: rejects when from_speaker does not match message.from_speaker", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "架构师-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: (stageId, speaker) => {
        if (speaker === "架构师-1") return messages.get(100);
        return undefined;
      },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    /** 架构师-2 尝试写入架构师-1 的消息 */
    await expect(handler({ text: "hello", message_id: "100", stage_id: "s1", from_speaker: "架构师-2" }))
      .rejects.toThrow("message 100 belongs to 架构师-1, not 架构师-2");
  });

  it("B-1: accepts when from_speaker matches message.from_speaker", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "架构师-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "s1", from_speaker: "架构师-1" });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
  });
});

describe("set_final_body concurrent safety (B-2)", () => {
  it("B-2: two agents get各自的消息 ID，互不干扰", async () => {
    const messages = new Map<number, Message>();
    messages.set(3636, { id: 3636, stage_id: "s1", from_speaker: "架构师-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    messages.set(3637, { id: 3637, stage_id: "s1", from_speaker: "架构师-2", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: (_stageId, speaker) => {
        if (speaker === "架构师-1") return messages.get(3636);
        if (speaker === "架构师-2") return messages.get(3637);
        return undefined;
      },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());

    /** 架构师-1 获取自己的消息 ID */
    const getMsgTool = server.tools[1];
    const result1 = await getMsgTool.handler({ stage_id: "s1", from_speaker: "架构师-1" });
    expect(result1).toEqual({ message_id: "3636", from_speaker: "架构师-1" });

    /** 架构师-2 获取自己的消息 ID */
    const result2 = await getMsgTool.handler({ stage_id: "s1", from_speaker: "架构师-2" });
    expect(result2).toEqual({ message_id: "3637", from_speaker: "架构师-2" });

    /** 架构师-1 写入自己的消息成功 */
    const setFinalTool = server.tools[0];
    const write1 = await setFinalTool.handler({ text: "架构师-1的回复", message_id: "3636", stage_id: "s1", from_speaker: "架构师-1" });
    expect(write1).toEqual({ ok: true, proceed: "end_turn" });

    /** 架构师-2 写入自己的消息成功 */
    const write2 = await setFinalTool.handler({ text: "架构师-2的回复", message_id: "3637", stage_id: "s1", from_speaker: "架构师-2" });
    expect(write2).toEqual({ ok: true, proceed: "end_turn" });
  });

  it("B-2: 架构师-1 不能写入架构师-2 的消息（即使 ID 更大）", async () => {
    const messages = new Map<number, Message>();
    messages.set(3636, { id: 3636, stage_id: "s1", from_speaker: "架构师-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    messages.set(3637, { id: 3637, stage_id: "s1", from_speaker: "架构师-2", to_speakers: [], status: "streaming", created_at: "", ended_at: null });

    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: (_stageId, speaker) => {
        if (speaker === "架构师-1") return messages.get(3636);
        if (speaker === "架构师-2") return messages.get(3637);
        return undefined;
      },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    /** 架构师-1 尝试写入架构师-2 的消息 → 被 speaker 归属校验拦截 */
    await expect(handler({ text: "串台内容", message_id: "3637", stage_id: "s1", from_speaker: "架构师-1" }))
      .rejects.toThrow("message 3637 belongs to 架构师-2, not 架构师-1");
  });
});

describe("set_final_body to_speakers validation", () => {
  /** 构造包含指定 role_instances 的 mock stagePort */
  function stagePortWithInstances(roleInstances: string[]) {
    return createMockStagePort({
      findStage: () => ({
        id: "stage-a",
        workspace_path: "",
        issue_id: "",
        key: "development",
        title: "",
        description: "",
        default_role_instance: roleInstances[0] ?? "",
        role_instances: roleInstances,
        from_stage_id: null,
        available_transitions: [],
        output_artifacts: {},
        entered_at: "",
        left_at: null,
      }),
    });
  }

  it("B1: accepts valid role instance name (excluding self)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let capturedTargets: string[] | undefined;
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: ["架构师-2"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["架构师-2"]);
  });

  it("B2: accepts 'user' as valid target", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let capturedTargets: string[] | undefined;
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: ["user"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["user"]);
  });

  it("B3: rejects invalid value (snail key)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: ["claude-code-stateful"] }))
      .rejects.toThrow('Invalid to_speakers: [claude-code-stateful]. Valid targets: [架构师-2] or "user".');
  });

  it("B4: rejects when mixed valid and invalid values", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: ["架构师-2", "claude-code-stateful"] }))
      .rejects.toThrow('Invalid to_speakers: [claude-code-stateful]. Valid targets: [架构师-2] or "user".');
  });

  it("B5: skips validation for empty to_speakers array", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: [] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
  });

  it("rejects self-routing (to_speakers contains current speaker)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: ["开发者"] }))
      .rejects.toThrow('Invalid to_speakers: [开发者]. Valid targets: [架构师-2] or "user".');
  });

  it("skips validation when to_speakers is not provided", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者" });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
  });

  it("skips validation when stage is not found (defensive fallback)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let capturedTargets: string[] | undefined;
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    /** stagePort.findStage 返回 undefined（异常路径） */
    const server = createFinalResponseServer(port, store, createMockStagePort());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: ["anyone"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["anyone"]);
  });

  it("accepts multiple valid targets", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let capturedTargets: string[] | undefined;
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, stagePortWithInstances(["开发者", "架构师-2", "审查者-1"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "开发者", to_speakers: ["架构师-2", "审查者-1", "user"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["架构师-2", "审查者-1", "user"]);
  });
});

describe("set_final_body does not extract stage_transition signals", () => {
  function createPortWithEventCapture(overrides: Partial<MessagePort> = {}): { port: MessagePort; events: Array<{ messageId: number; payload: MessageEventPayload }> } {
    const events: Array<{ messageId: number; payload: MessageEventPayload }> = [];
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
      appendEvent: (messageId, payload) => {
        events.push({ messageId, payload });
        return { id: events.length, message_id: messageId, seq: events.length, payload, created_at: "" } as MessageEvent;
      },
      ...overrides,
    });
    return { port, events };
  }

  it("does not append signal event when text contains stage_transition JSON", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const signalJson = JSON.stringify({
      stage_transition: {
        target_key: "review",
        reason: "All gates passed",
      },
    });
    await handler({ text: signalJson, message_id: "100", stage_id: "s1", from_speaker: "dev" });

    expect(events).toHaveLength(0);
  });

  it("does not append signal event for plain text", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await handler({ text: "Just a regular message", message_id: "100", stage_id: "s1", from_speaker: "dev" });

    expect(events).toHaveLength(0);
  });

  it("still writes mcp_final_body for text content", async () => {
    let writtenKind: string | undefined;
    const { port } = createPortWithEventCapture({
      setContext: (_id, kind) => { writtenKind = kind; },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await handler({ text: "Regular content", message_id: "100", stage_id: "s1", from_speaker: "dev" });

    expect(writtenKind).toBe("mcp_final_body");
  });
});

describe("set_final_body idempotent guard (B2)", () => {
  function createPortWithCapture(): {
    port: MessagePort;
    mcpStore: McpMessageStore;
    contextWrites: Array<{ id: number; kind: string; ctx: unknown }>;
    events: Array<{ messageId: number; payload: MessageEventPayload }>;
    routingWrites: Array<{ messageId: number; targets: string[] }>;
  } {
    const contextWrites: Array<{ id: number; kind: string; ctx: unknown }> = [];
    const events: Array<{ messageId: number; payload: MessageEventPayload }> = [];
    const routingWrites: Array<{ messageId: number; targets: string[] }> = [];
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
      setContext: (id, kind, ctx) => { contextWrites.push({ id, kind, ctx }); },
      appendEvent: (messageId, payload) => {
        events.push({ messageId, payload });
        return { id: events.length, message_id: messageId, seq: events.length, payload, created_at: "" } as MessageEvent;
      },
    });
    const mcpStore: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (messageId, targets) => { routingWrites.push({ messageId, targets }); },
      deleteMcpRoutingTargets: () => {},
    };
    return { port, mcpStore, contextWrites, events, routingWrites };
  }

  it("B2: final body is idempotent but to_speakers updates on duplicate call", async () => {
    const { port, mcpStore, contextWrites, routingWrites } = createPortWithCapture();
    const server = createFinalResponseServer(port, mcpStore, createMockStagePort());
    const handler = server.tools[0].handler;

    /** 首次调用 */
    const first = await handler({ text: "body v1", message_id: "100", stage_id: "s1", from_speaker: "dev", to_speakers: ["reviewer"] });
    expect(first).toEqual({ ok: true, proceed: "end_turn" });
    expect(contextWrites).toHaveLength(1);
    expect(routingWrites).toHaveLength(1);

    /** 重复调用：final body 不覆写，但 to_speakers 更新 */
    const second = await handler({ text: "body v2", message_id: "100", stage_id: "s1", from_speaker: "dev", to_speakers: ["other"] });
    expect(second).toEqual({ ok: true, already_submitted: true, hint: "final body already recorded for this message; your response is complete" });
    /** final body 不覆写 */
    expect(contextWrites).toHaveLength(1);
    expect(contextWrites[0].ctx).toBe("body v1");
    /** to_speakers 更新 */
    expect(routingWrites).toHaveLength(2);
    expect(routingWrites[1].targets).toEqual(["other"]);
  });

  it("B1: to_speakers is written to store even on duplicate call (non-idempotent)", async () => {
    const { port, mcpStore, routingWrites } = createPortWithCapture();
    const server = createFinalResponseServer(port, mcpStore, createMockStagePort());
    const handler = server.tools[0].handler;

    /** 首次调用带 to_speakers */
    await handler({ text: "body v1", message_id: "100", stage_id: "s1", from_speaker: "dev", to_speakers: ["reviewer-1"] });
    expect(routingWrites).toHaveLength(1);
    expect(routingWrites[0].targets).toEqual(["reviewer-1"]);

    /** 重复调用带不同 to_speakers → 仍写入 store */
    await handler({ text: "body v2", message_id: "100", stage_id: "s1", from_speaker: "dev", to_speakers: ["reviewer-2"] });
    expect(routingWrites).toHaveLength(2);
    expect(routingWrites[1].targets).toEqual(["reviewer-2"]);
  });

  it("B3: to_speakers validation still runs on duplicate call", async () => {
    const { port, mcpStore } = createPortWithCapture();
    const stagePort = createMockStagePort({
      findStage: () => ({
        id: "s1", workspace_path: "", issue_id: "", key: "development", title: "", description: "",
        default_role_instance: "dev", role_instances: ["dev", "reviewer"], from_stage_id: null,
        available_transitions: [], output_artifacts: {}, entered_at: "", left_at: null,
      }),
    });
    const server = createFinalResponseServer(port, mcpStore, stagePort);
    const handler = server.tools[0].handler;

    /** 首次调用成功 */
    await handler({ text: "body", message_id: "100", stage_id: "s1", from_speaker: "dev", to_speakers: ["reviewer"] });

    /** 重复调用传入无效目标 → 仍抛错 */
    await expect(handler({ text: "body v2", message_id: "100", stage_id: "s1", from_speaker: "dev", to_speakers: ["invalid-target"] }))
      .rejects.toThrow('Invalid to_speakers: [invalid-target]. Valid targets: [reviewer] or "user".');
  });

  it("B4: duplicate call returns warning from to_speakers validation", async () => {
    const { mcpStore } = createPortWithCapture();
    const designStagePort = createMockStagePort({
      findStage: () => ({
        id: "s1", workspace_path: "", issue_id: "", key: "design", title: "", description: "",
        default_role_instance: "架构师-1", role_instances: ["架构师-1", "架构师-2"], from_stage_id: null,
        available_transitions: [], output_artifacts: {}, entered_at: "", left_at: null,
      }),
    });
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "架构师-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const portWithMsg = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
      setContext: () => {},
      appendEvent: () => ({ id: 1, message_id: 100, seq: 1, payload: { type: "text", text: "" }, created_at: "" }) as MessageEvent,
    });
    const server = createFinalResponseServer(portWithMsg, mcpStore, designStagePort);
    const handler = server.tools[0].handler;

    /** 首次调用不带 to_speakers */
    await handler({ text: "body", message_id: "100", stage_id: "s1", from_speaker: "架构师-1" });

    /** 重复调用带 to_speakers: ["user"] → 返回 warning */
    const result = await handler({ text: "body v2", message_id: "100", stage_id: "s1", from_speaker: "架构师-1", to_speakers: ["user"] });
    expect(result).toEqual({
      ok: true,
      already_submitted: true,
      hint: "final body already recorded for this message; your response is complete",
      warning: "Design阶段提醒：您的草稿方案是否已经过对方架构师审视？建议先路由给对方架构师进行对抗审视。",
    });
  });

  it("does not write final body on duplicate call", async () => {
    const { port, mcpStore, events } = createPortWithCapture();
    const server = createFinalResponseServer(port, mcpStore, createMockStagePort());
    const handler = server.tools[0].handler;

    /** 首次调用 */
    await handler({ text: "First message", message_id: "100", stage_id: "s1", from_speaker: "dev" });
    expect(events).toHaveLength(0);

    /** 重复调用 */
    await handler({ text: "Second message", message_id: "100", stage_id: "s1", from_speaker: "dev" });
    /** 事件数不变 */
    expect(events).toHaveLength(0);
  });

  it("different message IDs are tracked independently", async () => {
    const contextWrites: Array<{ id: number; kind: string; ctx: unknown }> = [];
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    /** 模拟两轮调用：第一轮 message 100 是最新，第二轮 message 200 是最新 */
    let latestId = 100;
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(latestId),
      setContext: (id, kind, ctx) => { contextWrites.push({ id, kind, ctx }); },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    /** 第一轮：message 100 */
    await handler({ text: "body 100", message_id: "100", stage_id: "s1", from_speaker: "dev" });
    expect(contextWrites).toHaveLength(1);

    /** 第二轮：message 200 成为最新 */
    messages.set(200, { id: 200, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    latestId = 200;
    await handler({ text: "body 200", message_id: "200", stage_id: "s1", from_speaker: "dev" });
    expect(contextWrites).toHaveLength(2);

    /** 重复调用 message 200 */
    const result = await handler({ text: "body 200 v2", message_id: "200", stage_id: "s1", from_speaker: "dev" });
    expect(result).toMatchObject({ already_submitted: true });
    expect(contextWrites).toHaveLength(2);
  });

  it("still validates params on duplicate call", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    /** 首次调用 */
    await handler({ text: "body", message_id: "100", stage_id: "s1", from_speaker: "dev" });
    /** 重复调用时参数错误仍应报错 */
    await expect(handler({ text: "", message_id: "100", stage_id: "s1", from_speaker: "dev" }))
      .rejects.toThrow("text is required");
    await expect(handler({ text: "body", message_id: "100", stage_id: "s2", from_speaker: "dev" }))
      .rejects.toThrow("message_id 100 does not belong to stage s2");
  });
});

describe("set_final_body tool description (B3)", () => {
  it("contains termination semantics in description", () => {
    const server = createFinalResponseServer(createMockMessagePort(), createMockMcpMessageStore(), createMockStagePort());
    const description = server.tools[0].description;
    expect(description).toContain("调用此工具后，你的发言即告结束");
    expect(description).toContain("不得再调用任何其他工具");
  });
});

describe("set_final_body freshness validation (AC-1, AC-2)", () => {
  it("AC-1: rejects when message is not streaming (completed)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "completed", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "s1", from_speaker: "dev" }))
      .rejects.toThrow("message 100 is not streaming (actual: completed)");
  });

  it("AC-1b: rejects when message is not streaming (failed)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "failed", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(100),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "s1", from_speaker: "dev" }))
      .rejects.toThrow("message 100 is not streaming (actual: failed)");
  });

  it("AC-2: rejects when message_id is not the latest streaming message for speaker", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    messages.set(200, { id: 200, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => messages.get(200),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    /** 传入旧的 message_id 100，但最新 streaming 是 200 */
    await expect(handler({ text: "hello", message_id: "100", stage_id: "s1", from_speaker: "dev" }))
      .rejects.toThrow("message 100 is not the active streaming message for dev in stage s1 (latest streaming: 200)");
  });

  it("AC-2b: rejects when findLatestMessageBySpeaker returns undefined (freshness path)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      findLatestMessageBySpeaker: () => undefined,
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "s1", from_speaker: "dev" }))
      .rejects.toThrow("no message found for stage s1 and speaker dev (message_id: 100)");
  });
});

describe("get_current_message_id tool (AC-3)", () => {
  it("AC-3: returns correct streaming message_id and from_speaker", async () => {
    const messages = new Map<number, Message>();
    messages.set(42, { id: 42, stage_id: "s1", from_speaker: "架构师-2", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      findLatestMessageBySpeaker: () => messages.get(42),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const tool = server.tools[1];

    const result = await tool.handler({ stage_id: "s1", from_speaker: "架构师-2" });
    expect(result).toEqual({ message_id: "42", from_speaker: "架构师-2" });
  });

  it("AC-3b: throws when no streaming message found", async () => {
    const messages = new Map<number, Message>();
    messages.set(42, { id: 42, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "completed", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      findLatestMessageBySpeaker: () => messages.get(42),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const tool = server.tools[1];

    await expect(tool.handler({ stage_id: "s1", from_speaker: "dev" }))
      .rejects.toThrow("no active streaming message found for stage s1 and speaker dev (latest: 42, status: completed)");
  });

  it("AC-3c: throws when no message found for stage and speaker", async () => {
    const port = createMockMessagePort({
      findLatestMessageBySpeaker: () => undefined,
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const tool = server.tools[1];

    await expect(tool.handler({ stage_id: "s1", from_speaker: "dev" }))
      .rejects.toThrow("no message found for stage s1 and speaker dev");
  });

  it("AC-3d: throws when stage_id is missing", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const tool = server.tools[1];

    await expect(tool.handler({ from_speaker: "dev" }))
      .rejects.toThrow("stage_id is required");
  });

  it("AC-3e: throws when from_speaker is missing", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const tool = server.tools[1];

    await expect(tool.handler({ stage_id: "s1" }))
      .rejects.toThrow("from_speaker is required");
  });
});

describe("set_final_body design stage soft reminder", () => {
  /** 构造 design 阶段的 mock stagePort */
  function designStagePortWithInstances(roleInstances: string[]) {
    return createMockStagePort({
      findStage: () => ({
        id: "design-stage",
        workspace_path: "",
        issue_id: "",
        key: "design",
        title: "",
        description: "",
        default_role_instance: roleInstances[0] ?? "",
        role_instances: roleInstances,
        from_stage_id: null,
        available_transitions: [],
        output_artifacts: {},
        entered_at: "",
        left_at: null,
      }),
    });
  }

  it("design阶段+架构师路由给user→返回warning", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "design-stage", from_speaker: "架构师-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: () => {},
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, designStagePortWithInstances(["架构师-1", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "design-stage", from_speaker: "架构师-1", to_speakers: ["user"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn", warning: "Design阶段提醒：您的草稿方案是否已经过对方架构师审视？建议先路由给对方架构师进行对抗审视。" });
  });

  it("design阶段+非架构师路由给user→无warning", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "design-stage", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: () => {},
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, designStagePortWithInstances(["开发者", "架构师-1"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "design-stage", from_speaker: "开发者", to_speakers: ["user"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
  });

  it("非design阶段+架构师路由给user→无warning", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "架构师-1", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id), findLatestMessageBySpeaker: () => messages.get(100) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: () => {},
      deleteMcpRoutingTargets: () => {},
    };
    const nonDesignStagePort = createMockStagePort({
      findStage: () => ({
        id: "stage-a",
        workspace_path: "",
        issue_id: "",
        key: "development",
        title: "",
        description: "",
        default_role_instance: "架构师-1",
        role_instances: ["架构师-1", "架构师-2"],
        from_stage_id: null,
        available_transitions: [],
        output_artifacts: {},
        entered_at: "",
        left_at: null,
      }),
    });
    const server = createFinalResponseServer(port, store, nonDesignStagePort);
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", from_speaker: "架构师-1", to_speakers: ["user"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
  });
});
