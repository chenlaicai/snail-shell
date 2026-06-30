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
      setContext: (id, kind, ctx) => { writtenId = id; writtenKind = kind; writtenCtx = ctx; },
    });

    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a" });
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

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-b" }))
      .rejects.toThrow("message_id 100 does not belong to stage stage-b (actual: stage-a)");
  });

  it("rejects when message_id does not exist", async () => {
    const port = createMockMessagePort({
      getMessage: () => undefined,
    });

    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "999", stage_id: "stage-a" }))
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

    const result = await handler({ text: "hello", message_id: "100" });
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

    await expect(handler({ text: "hello", message_id: "0", stage_id: "stage-a" }))
      .rejects.toThrow("message_id must be a positive integer");
  });

  it("rejects non-integer message_id", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "abc", stage_id: "stage-a" }))
      .rejects.toThrow("message_id must be a positive integer");
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
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: ["架构师-2"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["架构师-2"]);
  });

  it("B2: accepts 'user' as valid target", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let capturedTargets: string[] | undefined;
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: ["user"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["user"]);
  });

  it("B3: rejects invalid value (snail key)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: ["claude-code-stateful"] }))
      .rejects.toThrow('Invalid to_speakers: [claude-code-stateful]. Valid targets: [架构师-2] or "user".');
  });

  it("B4: rejects when mixed valid and invalid values", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: ["架构师-2", "claude-code-stateful"] }))
      .rejects.toThrow('Invalid to_speakers: [claude-code-stateful]. Valid targets: [架构师-2] or "user".');
  });

  it("B5: skips validation for empty to_speakers array", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: [] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
  });

  it("rejects self-routing (to_speakers contains current speaker)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: ["开发者"] }))
      .rejects.toThrow('Invalid to_speakers: [开发者]. Valid targets: [架构师-2] or "user".');
  });

  it("skips validation when to_speakers is not provided", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), stagePortWithInstances(["开发者", "架构师-2"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a" });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
  });

  it("skips validation when stage is not found (defensive fallback)", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let capturedTargets: string[] | undefined;
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    /** stagePort.findStage 返回 undefined（异常路径） */
    const server = createFinalResponseServer(port, store, createMockStagePort());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: ["anyone"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["anyone"]);
  });

  it("accepts multiple valid targets", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "stage-a", from_speaker: "开发者", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    let capturedTargets: string[] | undefined;
    const port = createMockMessagePort({ getMessage: (id) => messages.get(id) });
    const store: McpMessageStore = {
      getMcpRoutingTargets: () => undefined,
      setMcpRoutingTargets: (_id, targets) => { capturedTargets = targets; },
      deleteMcpRoutingTargets: () => {},
    };
    const server = createFinalResponseServer(port, store, stagePortWithInstances(["开发者", "架构师-2", "审查者-1"]));
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a", to_speakers: ["架构师-2", "审查者-1", "user"] });
    expect(result).toEqual({ ok: true, proceed: "end_turn" });
    expect(capturedTargets).toEqual(["架构师-2", "审查者-1", "user"]);
  });
});

describe("set_final_body stage_transition signal extraction", () => {
  function createPortWithEventCapture(overrides: Partial<MessagePort> = {}): { port: MessagePort; events: Array<{ messageId: number; payload: MessageEventPayload }> } {
    const events: Array<{ messageId: number; payload: MessageEventPayload }> = [];
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      appendEvent: (messageId, payload) => {
        events.push({ messageId, payload });
        return { id: events.length, message_id: messageId, seq: events.length, payload, created_at: "" } as MessageEvent;
      },
      ...overrides,
    });
    return { port, events };
  }

  it("appends signal event when text contains valid stage_transition JSON", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const signalJson = JSON.stringify({
      stage_transition: {
        target_key: "review",
        consensus: true,
        reason: "All gates passed",
        gate_evidence: { "dev-01": "done", "dev-02": "passed" },
      },
    });
    await handler({ text: signalJson, message_id: "100", stage_id: "s1" });

    expect(events).toHaveLength(1);
    expect(events[0].messageId).toBe(100);
    expect(events[0].payload).toMatchObject({
      type: "signal",
      signal: "stage_transition",
      stage_transition: {
        target_key: "review",
        consensus: true,
        reason: "All gates passed",
        gate_evidence: { "dev-01": "done", "dev-02": "passed" },
      },
    });
  });

  it("extracts stage_transition from Markdown with embedded JSON block", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const text = `## Summary

Implementation complete.

\`\`\`json
{
  "stage_transition": {
    "target_key": "review",
    "consensus": true,
    "gate_evidence": { "dev-01": "done" }
  }
}
\`\`\``;
    await handler({ text, message_id: "100", stage_id: "s1" });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      type: "signal",
      signal: "stage_transition",
      stage_transition: {
        target_key: "review",
        consensus: true,
        gate_evidence: { "dev-01": "done" },
      },
    });
  });

  it("does not append signal event when text has no stage_transition", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await handler({ text: "Just a regular message", message_id: "100", stage_id: "s1" });

    expect(events).toHaveLength(0);
  });

  it("silently skips when stage_transition JSON is malformed", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await handler({ text: '{"stage_transition": {broken json', message_id: "100", stage_id: "s1" });

    expect(events).toHaveLength(0);
  });

  it("still writes mcp_final_body when signal is extracted", async () => {
    let writtenKind: string | undefined;
    const { port, events } = createPortWithEventCapture({
      setContext: (_id, kind) => { writtenKind = kind; },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const signalJson = JSON.stringify({ stage_transition: { target_key: "review", consensus: true } });
    await handler({ text: signalJson, message_id: "100", stage_id: "s1" });

    expect(writtenKind).toBe("mcp_final_body");
    expect(events).toHaveLength(1);
  });

  it("handles disagreement signal (consensus: false)", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    const signalJson = JSON.stringify({
      stage_transition: {
        target_key: "review",
        consensus: false,
        reason: "Disagreement on approach",
        positions: [{ speaker: "architect-1", stance: "against", argument: "Too risky" }],
      },
    });
    await handler({ text: signalJson, message_id: "100", stage_id: "s1" });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      type: "signal",
      signal: "stage_transition",
      stage_transition: {
        target_key: "review",
        consensus: false,
        positions: [{ speaker: "architect-1", stance: "against", argument: "Too risky" }],
      },
    });
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

  it("returns idempotent response on duplicate call and skips all writes", async () => {
    const { port, mcpStore, contextWrites, routingWrites } = createPortWithCapture();
    const server = createFinalResponseServer(port, mcpStore, createMockStagePort());
    const handler = server.tools[0].handler;

    /** 首次调用 */
    const first = await handler({ text: "body v1", message_id: "100", stage_id: "s1", to_speakers: ["reviewer"] });
    expect(first).toEqual({ ok: true, proceed: "end_turn" });
    expect(contextWrites).toHaveLength(1);
    expect(routingWrites).toHaveLength(1);

    /** 重复调用：即使传入不同 text，也不覆写 */
    const second = await handler({ text: "body v2", message_id: "100", stage_id: "s1", to_speakers: ["other"] });
    expect(second).toEqual({ ok: true, already_submitted: true, hint: "final body already recorded for this message; your response is complete" });
    /** 无新增写入 */
    expect(contextWrites).toHaveLength(1);
    expect(contextWrites[0].ctx).toBe("body v1");
    expect(routingWrites).toHaveLength(1);
    expect(routingWrites[0].targets).toEqual(["reviewer"]);
  });

  it("does not append signal event on duplicate call even with stage_transition", async () => {
    const { port, mcpStore, events } = createPortWithCapture();
    const server = createFinalResponseServer(port, mcpStore, createMockStagePort());
    const handler = server.tools[0].handler;

    const signalJson = JSON.stringify({ stage_transition: { target_key: "review", consensus: true } });
    /** 首次调用带 signal */
    await handler({ text: signalJson, message_id: "100", stage_id: "s1" });
    expect(events).toHaveLength(1);

    /** 重复调用带不同 signal */
    const signalJson2 = JSON.stringify({ stage_transition: { target_key: "merge", consensus: true } });
    await handler({ text: signalJson2, message_id: "100", stage_id: "s1" });
    /** 事件数不变 */
    expect(events).toHaveLength(1);
  });

  it("different message IDs are tracked independently", async () => {
    const contextWrites: Array<{ id: number; kind: string; ctx: unknown }> = [];
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    messages.set(200, { id: 200, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
      setContext: (id, kind, ctx) => { contextWrites.push({ id, kind, ctx }); },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    await handler({ text: "body 100", message_id: "100", stage_id: "s1" });
    await handler({ text: "body 200", message_id: "200", stage_id: "s1" });
    expect(contextWrites).toHaveLength(2);

    /** 重复调用 message 100 */
    const result = await handler({ text: "body 100 v2", message_id: "100", stage_id: "s1" });
    expect(result).toMatchObject({ already_submitted: true });
    expect(contextWrites).toHaveLength(2);
  });

  it("still validates params on duplicate call", async () => {
    const messages = new Map<number, Message>();
    messages.set(100, { id: 100, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "streaming", created_at: "", ended_at: null });
    const port = createMockMessagePort({
      getMessage: (id) => messages.get(id),
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore(), createMockStagePort());
    const handler = server.tools[0].handler;

    /** 首次调用 */
    await handler({ text: "body", message_id: "100", stage_id: "s1" });
    /** 重复调用时参数错误仍应报错 */
    await expect(handler({ text: "", message_id: "100", stage_id: "s1" }))
      .rejects.toThrow("text is required");
    await expect(handler({ text: "body", message_id: "100", stage_id: "s2" }))
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
