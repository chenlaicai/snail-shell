import { describe, it, expect, vi } from "vitest";
import { buildStageChain, isStageReEntry, MAX_CHAIN_DEPTH } from "@domain/issue/_internal/stage-chain";
import { buildStageHistoryBlock } from "@app/issue-collaboration/_internal/stage-history-block";
import { createMessageHistoryServer } from "@domain/snail-mcp-server/_internal/servers/snail-message-history";
import type { Stage } from "@domain/issue/model";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";
import type { Message, MessageContext } from "@domain/message/model";

function makeStage(overrides: Partial<Stage> & Pick<Stage, "id" | "key">): Stage {
  return {
    workspace_path: "/ws",
    issue_id: "issue-1",
    title: `Stage ${overrides.key}`,
    description: "",
    default_role_instance: "dev",
    role_instances: ["dev"],
    from_stage_id: null,
    available_transitions: [],
    output_artifacts: {},
    entered_at: "2026-07-02T10:00:00Z",
    left_at: null,
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

function createMockStagePort(stages: Stage[]): StagePort {
  return {
    findStage: vi.fn((id: string) => stages.find(s => s.id === id)),
    listStages: vi.fn(() => stages),
    listOpenStageIds: vi.fn(),
    listAllOpenStageIds: vi.fn(),
    previewStage: vi.fn(),
    getStageSnailAssignmentPlan: vi.fn(),
    transaction: <T>(fn: () => T): T => fn(),
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

// ── buildStageChain ─────────────────────────────────────────────────────

describe("buildStageChain", () => {
  it("单个 stage 无前驱 → 返回自身", () => {
    const s1 = makeStage({ id: "s1", key: "design" });
    const chain = buildStageChain([s1], "s1");
    expect(chain).toEqual([s1]);
  });

  it("多级链路 → 按正序返回", () => {
    const s1 = makeStage({ id: "s1", key: "design" });
    const s2 = makeStage({ id: "s2", key: "dev", from_stage_id: "s1" });
    const s3 = makeStage({ id: "s3", key: "review", from_stage_id: "s2" });
    const chain = buildStageChain([s1, s2, s3], "s3");
    expect(chain.map(s => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("防环：循环引用不死循环", () => {
    const s1 = makeStage({ id: "s1", key: "design", from_stage_id: "s2" });
    const s2 = makeStage({ id: "s2", key: "dev", from_stage_id: "s1" });
    const chain = buildStageChain([s1, s2], "s2");
    expect(chain.length).toBeLessThanOrEqual(MAX_CHAIN_DEPTH);
  });

  it("深度限制：超过 MAX_CHAIN_DEPTH 截断", () => {
    const stages: Stage[] = [];
    for (let i = 0; i < MAX_CHAIN_DEPTH + 5; i++) {
      stages.push(makeStage({
        id: `s${i}`,
        key: `stage-${i}`,
        from_stage_id: i > 0 ? `s${i - 1}` : null,
      }));
    }
    const chain = buildStageChain(stages, `s${MAX_CHAIN_DEPTH + 4}`);
    expect(chain.length).toBe(MAX_CHAIN_DEPTH);
  });
});

// ── isStageReEntry ──────────────────────────────────────────────────────

describe("isStageReEntry", () => {
  it("首次进入 → false", () => {
    const s1 = makeStage({ id: "s1", key: "design" });
    expect(isStageReEntry([s1], "s1")).toBe(false);
  });

  it("同 key 重新进入 → true", () => {
    const s1 = makeStage({ id: "s1", key: "design", left_at: "2026-07-02T11:00:00Z" });
    const s2 = makeStage({ id: "s2", key: "dev", from_stage_id: "s1", left_at: "2026-07-02T12:00:00Z" });
    const s3 = makeStage({ id: "s3", key: "design", from_stage_id: "s2" });
    expect(isStageReEntry([s1, s2, s3], "s3")).toBe(true);
  });

  it("不同 key → false", () => {
    const s1 = makeStage({ id: "s1", key: "design", left_at: "2026-07-02T11:00:00Z" });
    const s2 = makeStage({ id: "s2", key: "dev", from_stage_id: "s1" });
    expect(isStageReEntry([s1, s2], "s2")).toBe(false);
  });
});

// ── buildStageHistoryBlock ──────────────────────────────────────────────

describe("buildStageHistoryBlock", () => {
  it("单个当前 stage → 输出标题行 + (当前)", () => {
    const s1 = makeStage({ id: "s1", key: "design" });
    const stagePort = createMockStagePort([s1]);
    const messagePort = createMockMessagePort();
    const block = buildStageHistoryBlock(stagePort, messagePort, s1);
    expect(block).toContain("(当前)");
    expect(block).not.toContain("重新进入");
  });

  it("重新进入的 stage → 输出 (当前 · 重新进入)", () => {
    const s1 = makeStage({ id: "s1", key: "design", left_at: "2026-07-02T11:00:00Z" });
    const s2 = makeStage({ id: "s2", key: "dev", from_stage_id: "s1", left_at: "2026-07-02T12:00:00Z" });
    const s3 = makeStage({ id: "s3", key: "design", from_stage_id: "s2" });
    const stagePort = createMockStagePort([s1, s2, s3]);
    const messagePort = createMockMessagePort();
    const block = buildStageHistoryBlock(stagePort, messagePort, s3);
    expect(block).toContain("重新进入");
  });

  it("前序 stage 展示消息摘要", () => {
    const s1 = makeStage({ id: "s1", key: "design", left_at: "2026-07-02T11:00:00Z" });
    const s2 = makeStage({ id: "s2", key: "dev", from_stage_id: "s1" });
    const stagePort = createMockStagePort([s1, s2]);
    const messagePort = createMockMessagePort({
      listMessages: vi.fn((stageId: string): Message[] => {
        if (stageId === "s1") return [{ id: 1, stage_id: "s1", from_speaker: "架构师", to_speakers: [], status: "completed", created_at: "", ended_at: null }];
        return [];
      }),
      getContext: vi.fn((msgId: number): MessageContext | null => {
        if (msgId === 1) return { message_id: 1, kind: "final_text", context: "设计文档已锁定", created_at: "" };
        return null;
      }),
    });
    const block = buildStageHistoryBlock(stagePort, messagePort, s2);
    expect(block).toContain("架构师");
    expect(block).toContain("设计文档已锁定");
  });

  it("超过 DISPLAY_LIMIT → 省略更早阶段", () => {
    const stages: Stage[] = [];
    for (let i = 0; i < 10; i++) {
      stages.push(makeStage({
        id: `s${i}`,
        key: `stage-${i}`,
        from_stage_id: i > 0 ? `s${i - 1}` : null,
        left_at: i < 9 ? "2026-07-02T11:00:00Z" : null,
      }));
    }
    const currentStage = stages[9];
    const stagePort = createMockStagePort(stages);
    const messagePort = createMockMessagePort();
    const block = buildStageHistoryBlock(stagePort, messagePort, currentStage);
    expect(block).toContain("更早阶段");
  });
});

// ── get_stage_history MCP tool ──────────────────────────────────────────

describe("get_stage_history MCP tool", () => {
  async function callGetStageHistory(stages: Stage[], messagePortOverrides: Partial<MessagePort> = {}) {
    const stagePort = createMockStagePort(stages);
    const messagePort = createMockMessagePort(messagePortOverrides);
    const server = createMessageHistoryServer(stagePort, messagePort);
    const tool = server.tools.find(t => t.name === "get_stage_history")!;
    return tool.handler({ issue_id: "issue-1" }) as Promise<{
      stages: Array<{
        stage_id: string;
        key: string;
        is_current: boolean;
        is_re_entry: boolean;
        messages?: Array<{ message_id: number; content: string | null }>;
      }>;
      total_stages: number;
    }>;
  }

  it("无 stage → 返回空", async () => {
    const result = await callGetStageHistory([]);
    expect(result).toEqual({ stages: [], total_stages: 0 });
  });

  it("单个 stage → 返回 1 条", async () => {
    const s1 = makeStage({ id: "s1", key: "design" });
    const result = await callGetStageHistory([s1]);
    expect(result.total_stages).toBe(1);
    expect(result.stages[0].stage_id).toBe("s1");
    expect(result.stages[0].is_current).toBe(true);
    expect(result.stages[0].is_re_entry).toBe(false);
  });

  it("重新进入 → is_re_entry=true", async () => {
    const s1 = makeStage({ id: "s1", key: "design", left_at: "2026-07-02T11:00:00Z" });
    const s2 = makeStage({ id: "s2", key: "dev", from_stage_id: "s1", left_at: "2026-07-02T12:00:00Z" });
    const s3 = makeStage({ id: "s3", key: "design", from_stage_id: "s2" });
    const result = await callGetStageHistory([s1, s2, s3]);
    expect(result.total_stages).toBe(3);
    expect(result.stages[0].is_re_entry).toBe(false); // s1 design 首次
    expect(result.stages[2].is_re_entry).toBe(true);  // s3 design 重新进入
  });

  it("包含消息", async () => {
    const s1 = makeStage({ id: "s1", key: "design" });
    const result = await callGetStageHistory([s1], {
      listMessages: vi.fn((): Message[] => [
        { id: 1, stage_id: "s1", from_speaker: "dev", to_speakers: [], status: "completed", created_at: "", ended_at: null },
      ]),
      getContext: vi.fn((): MessageContext => ({ message_id: 1, kind: "final_text", context: "hello", created_at: "" })),
    });
    expect(result.stages[0].messages).toHaveLength(1);
    expect(result.stages[0].messages![0].content).toBe("hello");
  });
});
