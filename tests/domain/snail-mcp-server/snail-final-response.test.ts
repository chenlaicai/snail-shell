import { describe, it, expect, beforeEach } from "vitest";
import {
  createFinalResponseServer,
  mcpToSpeakersStore,
} from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";
import type { Message } from "@domain/message/model";
import type { Stage } from "@domain/issue/model";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    stage_id: "stage-1",
    from_speaker: "开发者",
    to_speakers: [],
    status: "streaming",
    created_at: new Date().toISOString(),
    ended_at: null,
    ...overrides,
  };
}

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    workspace_path: "/test",
    issue_id: "issue-1",
    key: "development",
    title: "开发",
    description: "",
    role_instances: ["开发者"],
    default_role_instance: "开发者",
    from_stage_id: null,
    available_transitions: [],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

function makeMockMessagePort(messages: Message[] = []): MessagePort {
  const contexts = new Map<number, { kind: string; context: string }>();
  return {
    createMessage: () => makeMessage(),
    getMessage: (id: number) => messages.find((m) => m.id === id),
    listMessages: () => [...messages],
    listMessagesByStatus: (status: string) => messages.filter((m) => m.status === status),
    updateMessageTargets: () => {},
    completeMessage: () => {},
    appendEvent: () => ({ id: 1, message_id: 1, seq: 1, payload: { type: "text", text: "" }, created_at: "" }),
    getMessageEvents: () => [],
    getContext: (id: number) => (contexts.has(id) ? { message_id: id, kind: contexts.get(id)!.kind as any, context: contexts.get(id)!.context, created_at: "" } : null),
    setContext: (id: number, kind: string, context: string) => { contexts.set(id, { kind, context }); },
    getCursor: () => 0,
    advanceCursor: () => {},
    getUnreadMessages: () => [],
    initCursor: () => {},
    findLatestRespondingSpeaker: () => null,
    findLatestMessage: () => undefined,
  } as unknown as MessagePort;
}

function makeMockStagePort(stages: Stage[] = []): StagePort {
  return {
    findStage: (id: string) => stages.find((s) => s.id === id),
    listStages: (issueId: string) => stages.filter((s) => s.issue_id === issueId),
    listOpenStageIds: (ids: string[]) => ids,
    listAllOpenStageIds: () => [],
    previewStage: () => ({} as any),
    getStageSnailAssignmentPlan: () => ({} as any),
    transaction: (fn: () => unknown) => fn(),
    createStage: () => makeStage(),
    addOutputArtifacts: () => {},
    advanceStage: () => makeStage(),
    switchSnail: () => {},
    setSnailInstanceId: () => {},
    getRoleSnailAssignments: () => [],
    getRoleSnailAssignment: () => null,
  } as unknown as StagePort;
}

function getTools(config: ReturnType<typeof createFinalResponseServer>) {
  const tools = new Map(config.tools.map((t) => [t.name, t]));
  return {
    getCurrentMessageId: tools.get("get_current_message_id")!,
    setFinalBody: tools.get("set_final_body")!,
  };
}

describe("snail-final-response MCP Server", () => {
  beforeEach(() => {
    mcpToSpeakersStore.clear();
  });

  // ── B1: get_current_message_id 返回正确的 message_id ──
  describe("B1: get_current_message_id with valid streaming message", () => {
    it("returns the correct message_id", async () => {
      const messages = [makeMessage({ id: 42, status: "streaming" })];
      const stages = [makeStage()];
      const config = createFinalResponseServer(makeMockMessagePort(messages), makeMockStagePort(stages));
      const { getCurrentMessageId } = getTools(config);

      const result = await getCurrentMessageId.handler({ issue_id: "issue-1" });
      expect(result).toEqual({ message_id: 42 });
    });

    it("returns the latest streaming message when multiple exist", async () => {
      const messages = [
        makeMessage({ id: 10, status: "streaming" }),
        makeMessage({ id: 20, status: "streaming" }),
        makeMessage({ id: 15, status: "completed" }),
      ];
      const stages = [makeStage()];
      const config = createFinalResponseServer(makeMockMessagePort(messages), makeMockStagePort(stages));
      const { getCurrentMessageId } = getTools(config);

      const result = await getCurrentMessageId.handler({ issue_id: "issue-1" });
      expect(result).toEqual({ message_id: 20 });
    });
  });

  // ── B2: get_current_message_id 无 streaming message 时报错 ──
  describe("B2: get_current_message_id with no streaming message", () => {
    it("throws 'No active streaming message found'", async () => {
      const messages = [makeMessage({ id: 1, status: "completed" })];
      const stages = [makeStage()];
      const config = createFinalResponseServer(makeMockMessagePort(messages), makeMockStagePort(stages));
      const { getCurrentMessageId } = getTools(config);

      await expect(getCurrentMessageId.handler({ issue_id: "issue-1" })).rejects.toThrow("No active streaming message found");
    });

    it("throws when no messages exist at all", async () => {
      const stages = [makeStage()];
      const config = createFinalResponseServer(makeMockMessagePort([]), makeMockStagePort(stages));
      const { getCurrentMessageId } = getTools(config);

      await expect(getCurrentMessageId.handler({ issue_id: "issue-1" })).rejects.toThrow("No active streaming message found");
    });
  });

  // ── B3: set_final_body 写入成功 + to_speakers 存入 store ──
  describe("B3: set_final_body with valid params", () => {
    it("writes mcp_final_body and stores to_speakers", async () => {
      const messages = [makeMessage({ id: 1 })];
      const mp = makeMockMessagePort(messages);
      const config = createFinalResponseServer(mp, makeMockStagePort([]));
      const { setFinalBody } = getTools(config);

      const result = await setFinalBody.handler({ text: "答复内容", message_id: "1", to_speakers: ["开发者"] });
      expect(result).toEqual({ ok: true });
      expect(mcpToSpeakersStore.get(1)).toEqual(["开发者"]);
    });
  });

  // ── B4: set_final_body message_id 无效时报错 ──
  describe("B4: set_final_body with invalid message_id", () => {
    it("throws when message_id is not a positive integer", async () => {
      const config = createFinalResponseServer(makeMockMessagePort([]), makeMockStagePort([]));
      const { setFinalBody } = getTools(config);

      await expect(setFinalBody.handler({ text: "答复", message_id: "analysis", to_speakers: ["开发者"] }))
        .rejects.toThrow("message_id must be a positive integer (call get_current_message_id first)");
    });

    it("throws when message_id is zero", async () => {
      const config = createFinalResponseServer(makeMockMessagePort([]), makeMockStagePort([]));
      const { setFinalBody } = getTools(config);

      await expect(setFinalBody.handler({ text: "答复", message_id: "0", to_speakers: ["开发者"] }))
        .rejects.toThrow("message_id must be a positive integer (call get_current_message_id first)");
    });
  });

  // ── B9: set_final_body text 为空时报错 ──
  describe("B9: set_final_body with empty text", () => {
    it("throws when text is empty", async () => {
      const config = createFinalResponseServer(makeMockMessagePort([]), makeMockStagePort([]));
      const { setFinalBody } = getTools(config);

      await expect(setFinalBody.handler({ text: "", message_id: "1", to_speakers: ["开发者"] }))
        .rejects.toThrow("text is required");
    });
  });

  // ── to_speakers 校验 ──
  describe("to_speakers validation", () => {
    it("throws when to_speakers is missing", async () => {
      const config = createFinalResponseServer(makeMockMessagePort([]), makeMockStagePort([]));
      const { setFinalBody } = getTools(config);

      await expect(setFinalBody.handler({ text: "答复", message_id: "1" }))
        .rejects.toThrow("to_speakers is required");
    });

    it("throws when to_speakers is empty array", async () => {
      const config = createFinalResponseServer(makeMockMessagePort([]), makeMockStagePort([]));
      const { setFinalBody } = getTools(config);

      await expect(setFinalBody.handler({ text: "答复", message_id: "1", to_speakers: [] }))
        .rejects.toThrow("to_speakers is required");
    });
  });
});
