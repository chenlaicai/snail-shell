import { describe, it, expect } from "vitest";
import { createFinalResponseServer } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import type { MessagePort } from "@domain/message/port";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { Message, MessageEvent, MessageEventPayload } from "@domain/message/model";

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

    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100", stage_id: "stage-a" });
    expect(result).toEqual({ ok: true });
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

    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "100", stage_id: "stage-b" }))
      .rejects.toThrow("message_id 100 does not belong to stage stage-b (actual: stage-a)");
  });

  it("rejects when message_id does not exist", async () => {
    const port = createMockMessagePort({
      getMessage: () => undefined,
    });

    const server = createFinalResponseServer(port, createMockMcpMessageStore());
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

    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    const result = await handler({ text: "hello", message_id: "100" });
    expect(result).toEqual({ ok: true });
    expect(writtenId).toBe(100);
  });

  it("rejects empty text", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "" }))
      .rejects.toThrow("text is required");
  });

  it("rejects non-positive message_id", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "0", stage_id: "stage-a" }))
      .rejects.toThrow("message_id must be a positive integer");
  });

  it("rejects non-integer message_id", async () => {
    const port = createMockMessagePort();
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    await expect(handler({ text: "hello", message_id: "abc", stage_id: "stage-a" }))
      .rejects.toThrow("message_id must be a positive integer");
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
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
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
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
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
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    await handler({ text: "Just a regular message", message_id: "100", stage_id: "s1" });

    expect(events).toHaveLength(0);
  });

  it("silently skips when stage_transition JSON is malformed", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    await handler({ text: '{"stage_transition": {broken json', message_id: "100", stage_id: "s1" });

    expect(events).toHaveLength(0);
  });

  it("still writes mcp_final_body when signal is extracted", async () => {
    let writtenKind: string | undefined;
    const { port, events } = createPortWithEventCapture({
      setContext: (_id, kind) => { writtenKind = kind; },
    });
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
    const handler = server.tools[0].handler;

    const signalJson = JSON.stringify({ stage_transition: { target_key: "review", consensus: true } });
    await handler({ text: signalJson, message_id: "100", stage_id: "s1" });

    expect(writtenKind).toBe("mcp_final_body");
    expect(events).toHaveLength(1);
  });

  it("handles disagreement signal (consensus: false)", async () => {
    const { port, events } = createPortWithEventCapture();
    const server = createFinalResponseServer(port, createMockMcpMessageStore());
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
