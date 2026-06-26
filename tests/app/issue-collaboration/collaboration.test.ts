import { describe, it, expect, beforeEach } from "vitest";
import { IssueCollaboration } from "@app/issue-collaboration/collaboration";
import { mcpToSpeakersStore } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { Message, MessageEvent, MessageContext } from "@domain/message/model";
import type { Stage, Issue } from "@domain/issue/model";

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
    role_instances: ["开发者", "审查者"],
    default_role_instance: "开发者",
    from_stage_id: null,
    available_transitions: [],
    output_artifacts: {},
    entered_at: new Date().toISOString(),
    left_at: null,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    workspace_path: "/test",
    title: "Test Issue",
    summary: null,
    context: {},
    sop_snapshot: {
      key: "test-sop",
      title: "Test SOP",
      stage_definitions: [],
      shared_skill: null,
    },
    closed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as unknown as Issue;
}

function makeTextEvent(text: string, seq = 1): MessageEvent {
  return {
    id: seq,
    message_id: 1,
    seq,
    payload: { type: "text", text },
    created_at: new Date().toISOString(),
  };
}

/**
 * 创建 IssueCollaboration 实例，仅注入测试所需的最小依赖。
 * 大部分 port 方法用 stub 实现，测试通过直接调用私有方法验证行为。
 */
function createCollaboration(deps?: {
  messageEvents?: MessageEvent[];
  context?: MessageContext | null;
  messages?: Message[];
}) {
  const messageEvents = deps?.messageEvents ?? [];
  const context = deps?.context ?? null;
  const messages = deps?.messages ?? [makeMessage()];

  const messagePort = {
    createMessage: () => makeMessage(),
    getMessage: (id: number) => messages.find((m) => m.id === id),
    listMessages: () => [...messages],
    listMessagesByStatus: () => [],
    updateMessageTargets: () => {},
    completeMessage: () => {},
    appendEvent: () => makeTextEvent(""),
    getMessageEvents: () => messageEvents,
    getContext: () => context,
    setContext: () => {},
    getCursor: () => 0,
    advanceCursor: () => {},
    getUnreadMessages: () => [],
    initCursor: () => {},
    findLatestRespondingSpeaker: () => null,
    findLatestMessage: () => undefined,
  } as unknown as MessagePort;

  const issuePort = {
    findIssue: () => makeIssue(),
    listIssues: () => [],
    previewSopStages: () => [],
    validateSnailAssignmentPlan: () => {},
    updateContext: () => {},
    closeIssue: () => makeIssue(),
  } as unknown as IssuePort;

  const stagePort = {
    findStage: () => makeStage(),
    listStages: () => [makeStage()],
    listOpenStageIds: (ids: string[]) => ids,
    listAllOpenStageIds: () => [],
    previewStage: () => ({} as any),
    getStageSnailAssignmentPlan: () => ({} as any),
    transaction: (fn: () => any) => fn(),
    createStage: () => makeStage(),
    addOutputArtifacts: () => {},
    advanceStage: () => makeStage(),
    switchSnail: () => {},
    setSnailInstanceId: () => {},
    getRoleSnailAssignments: () => [],
    getRoleSnailAssignment: () => null,
  } as unknown as StagePort;

  const snailPort = {} as unknown as SnailPort;
  const liteAIPort = { getConfig: () => null } as unknown as LiteAIPort;

  const collaboration = new IssueCollaboration({
    issuePort,
    createIssue: () => makeIssue(),
    stagePort,
    messagePort,
    snailPort,
    liteAIPort,
  });

  return { collaboration, messagePort };
}

describe("IssueCollaboration", () => {
  beforeEach(() => {
    mcpToSpeakersStore.clear();
  });

  // ── B5: MCP to_speakers 严格优先级（不合并） ──
  describe("B5: MCP to_speakers strict priority (no merge)", () => {
    it("uses MCP to_speakers directly, ignoring text mentions", () => {
      /** 严格优先级：有 MCP to_speakers 时直接使用，不与文本 mentions 合并 */
      mcpToSpeakersStore.set(1, ["审查者"]);
      const { collaboration } = createCollaboration({
        messageEvents: [makeTextEvent("@开发者 请帮我看看")],
      });

      const resolveReplyTargets = (collaboration as any).resolveReplyTargets.bind(collaboration);
      const stage = makeStage();
      const targets = resolveReplyTargets(stage, "开发者", 1);

      expect(targets).toEqual(["审查者"]);
      // MCP store 已被消费删除
      expect(mcpToSpeakersStore.get(1)).toBeUndefined();
    });

    it("falls back to text mentions when no MCP to_speakers", () => {
      /** 无 MCP to_speakers 时降级到文本 mentions */
      const { collaboration } = createCollaboration({
        messageEvents: [makeTextEvent("@审查者 请帮我看看")],
      });

      const resolveReplyTargets = (collaboration as any).resolveReplyTargets.bind(collaboration);
      const stage = makeStage();
      const targets = resolveReplyTargets(stage, "开发者", 1);

      expect(targets).toContain("审查者");
    });

    it("MCP to_speakers takes priority over message-payload mentions", () => {
      /** 严格优先级：MCP > message-payload > 文本 */
      mcpToSpeakersStore.set(1, ["开发者"]);
      // 模拟 messagePayloadMentionsStore 有数据
      const { collaboration } = createCollaboration();
      (collaboration as any).messagePayloadMentionsStore.set(1, ["审查者"]);

      const resolveReplyTargets = (collaboration as any).resolveReplyTargets.bind(collaboration);
      const stage = makeStage();
      const targets = resolveReplyTargets(stage, "user", 1);

      expect(targets).toEqual(["开发者"]);
      // messagePayloadMentionsStore 未被消费（高优先级已返回）
      expect((collaboration as any).messagePayloadMentionsStore.get(1)).toEqual(["审查者"]);
      // 清理
      (collaboration as any).messagePayloadMentionsStore.delete(1);
    });
  });

  // ── B6: 未调用 set_final_body 时仅从文本提取 mentions ──
  describe("B6: text-only mention extraction", () => {
    it("extracts @mentions from text events", () => {
      const { collaboration } = createCollaboration({
        messageEvents: [makeTextEvent("@审查者 请帮我看看这段代码")],
      });

      const resolveReplies = (collaboration as any).resolveReplies.bind(collaboration);
      const stage = makeStage();
      const targets = resolveReplies(stage, "开发者", 1);

      expect(targets).toContain("审查者");
    });

    it("does not include self-mentions", () => {
      const { collaboration } = createCollaboration({
        messageEvents: [makeTextEvent("@开发者 自己说的话")],
      });

      const resolveReplies = (collaboration as any).resolveReplies.bind(collaboration);
      const stage = makeStage();
      const targets = resolveReplies(stage, "开发者", 1);

      expect(targets).not.toContain("开发者");
    });
  });

  // ── B7: JSON payload 含 fallback_text 时提取 fallback_text + mentions ──
  describe("B7: JSON payload fallback extraction", () => {
    it("extracts fallback_text from format=blocks JSON", () => {
      const jsonPayload = JSON.stringify({
        format: "blocks",
        fallback_text: "这是降级文本",
        blocks: [{ type: "summary", content: "详细内容" }],
      });

      const { collaboration } = createCollaboration();
      const tryExtract = (collaboration as any).tryExtractJsonPayloadFallback.bind(collaboration);
      const result = tryExtract(jsonPayload);

      expect(result).toEqual({ fallback: "这是降级文本", mentions: [] });
    });

    it("extracts mentions from blocks[0].mentions", () => {
      const jsonPayload = JSON.stringify({
        format: "blocks",
        fallback_text: "请处理",
        blocks: [{ type: "text", text: "请处理", mentions: ["开发者", "审查者"] }],
      });

      const { collaboration } = createCollaboration();
      const tryExtract = (collaboration as any).tryExtractJsonPayloadFallback.bind(collaboration);
      const result = tryExtract(jsonPayload);

      expect(result).toEqual({ fallback: "请处理", mentions: ["开发者", "审查者"] });
    });

    it("returns null for JSON without format=blocks", () => {
      const jsonPayload = JSON.stringify({ type: "other", text: "some text" });

      const { collaboration } = createCollaboration();
      const tryExtract = (collaboration as any).tryExtractJsonPayloadFallback.bind(collaboration);
      const result = tryExtract(jsonPayload);

      expect(result).toBeNull();
    });

    it("returns null for JSON with format=blocks but no fallback_text", () => {
      const jsonPayload = JSON.stringify({ format: "blocks", blocks: [] });

      const { collaboration } = createCollaboration();
      const tryExtract = (collaboration as any).tryExtractJsonPayloadFallback.bind(collaboration);
      const result = tryExtract(jsonPayload);

      expect(result).toBeNull();
    });

    it("returns null for non-JSON text", () => {
      const { collaboration } = createCollaboration();
      const tryExtract = (collaboration as any).tryExtractJsonPayloadFallback.bind(collaboration);
      const result = tryExtract("这不是 JSON");

      expect(result).toBeNull();
    });
  });

  // ── B8: 纯文本时保持现有行为 ──
  describe("B8: plain text preserves existing behavior", () => {
    it("extractTerminalContext returns final_text for plain text event", () => {
      const events = [makeTextEvent("这是纯文本回复")];
      const { collaboration } = createCollaboration({ messageEvents: events });

      const extractTerminalContext = (collaboration as any).extractTerminalContext.bind(collaboration);
      const result = extractTerminalContext(1, "completed");

      expect(result.kind).toBe("final_text");
      expect(result.context).toBe("这是纯文本回复");
    });

    it("extractTerminalContext returns mcp_final_body when already set", () => {
      const existingContext: MessageContext = {
        message_id: 1,
        kind: "mcp_final_body",
        context: "MCP 内容",
        created_at: new Date().toISOString(),
      };
      const { collaboration } = createCollaboration({ context: existingContext });

      const extractTerminalContext = (collaboration as any).extractTerminalContext.bind(collaboration);
      const result = extractTerminalContext(1, "completed");

      expect(result.kind).toBe("mcp_final_body");
      expect(result.context).toBe("MCP 内容");
    });

    it("extractTerminalContext uses JSON fallback when last text is JSON payload", () => {
      const jsonText = JSON.stringify({ format: "blocks", fallback_text: "降级内容", blocks: [] });
      const events = [makeTextEvent(jsonText)];
      const { collaboration } = createCollaboration({ messageEvents: events });

      const extractTerminalContext = (collaboration as any).extractTerminalContext.bind(collaboration);
      const result = extractTerminalContext(1, "completed");

      expect(result.kind).toBe("final_text");
      expect(result.context).toBe("降级内容");
    });

    it("extractTerminalContext returns event_summary when no text events", () => {
      const { collaboration } = createCollaboration({ messageEvents: [] });

      const extractTerminalContext = (collaboration as any).extractTerminalContext.bind(collaboration);
      const result = extractTerminalContext(1, "completed");

      expect(result.kind).toBe("event_summary");
    });
  });
});
