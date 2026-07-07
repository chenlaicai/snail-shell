import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { Message, MessageContext } from "@domain/message/model";
import { buildStageChain } from "@domain/issue/port";

/**
 * snail-message-history MCP Server。
 * 替代旧 conversation-history skill，提供跨 stage 的消息查询能力。
 */
export function createMessageHistoryServer(
  stagePort: StagePort,
  messagePort: MessagePort,
): MCPServerConfig {
  return {
    name: "snail-message-history",
    version: "1.0.0",
    tools: [
      createSearchMessagesTool(stagePort, messagePort),
      createListMessagesTool(stagePort, messagePort),
      createGetMessageTool(messagePort),
      createGetMessageWindowTool(stagePort, messagePort),
      createGetStageHistoryTool(stagePort, messagePort),
    ],
  };
}

/** 跨 stage 关键词搜索（FTS5，B12 升级） */
function createSearchMessagesTool(stagePort: StagePort, messagePort: MessagePort): MCPTool {
  return {
    name: "search_messages",
    description: "跨 stage 关键词搜索消息。返回匹配的消息列表，包含消息内容和所属 stage。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID" },
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "number", description: "返回结果数量限制，默认 10" },
      },
      required: ["issue_id", "query"],
    },
    handler: async (params) => {
      const { issue_id, query, limit = 10 } = params as { issue_id: string; query: string; limit?: number };
      const stages = stagePort.listStages(issue_id);
      const stageIds = stages.map((s) => s.id);

      const results = messagePort.searchByFts(stageIds, query, limit);

      return {
        results: results.map((r) => ({
          message_id: r.message_id,
          stage_id: r.stage_id,
          from_speaker: r.from_speaker,
          content: r.content,
          created_at: r.created_at,
        })),
        total: results.length,
      };
    },
  };
}

/** 跨 stage 消息列表 */
function createListMessagesTool(stagePort: StagePort, messagePort: MessagePort): MCPTool {
  return {
    name: "list_messages",
    description: "跨 stage 消息列表。支持 recent（每个 stage 最近用户消息及后续）和 page（按时间分页）两种模式。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID" },
        mode: { type: "string", enum: ["recent", "page"], description: "查询模式：recent 或 page" },
        limit: { type: "number", description: "返回结果数量限制，默认 10" },
        before_id: { type: "number", description: "分页参数：返回此 ID 之前的消息（仅 page 模式）" },
      },
      required: ["issue_id", "mode"],
    },
    handler: async (params) => {
      const { issue_id, mode, limit = 10, before_id } = params as {
        issue_id: string; mode: "recent" | "page"; limit?: number; before_id?: number;
      };
      const stages = stagePort.listStages(issue_id);

      if (mode === "recent") {
        // 每个 stage 最近的消息，跨 stage 聚合后按 limit 裁剪
        const all: Array<{ message: Message; context: MessageContext | null; stage_id: string }> = [];
        for (const stage of stages) {
          for (const msg of messagePort.listMessages(stage.id, limit)) {
            all.push({ message: msg, context: messagePort.getContext(msg.id), stage_id: stage.id });
          }
        }
        all.sort((a, b) => b.message.id - a.message.id);
        const trimmed = all.slice(0, limit);

        // 按 stage 分组返回
        const byStage = new Map<string, typeof trimmed>();
        for (const item of trimmed) {
          let arr = byStage.get(item.stage_id);
          if (!arr) { arr = []; byStage.set(item.stage_id, arr); }
          arr.push(item);
        }
        return {
          results: [...byStage.entries()].map(([stage_id, items]) => ({
            stage_id,
            messages: items.map((m) => ({
              message_id: m.message.id,
              from_speaker: m.message.from_speaker,
              content: m.context?.context ?? null,
              created_at: m.message.created_at,
            })),
          })),
        };
      }

      // page 模式：每个 stage 取 limit+1 条用于判断 has_more，跨 stage 合并分页
      const all: Array<{ message: Message; context: MessageContext | null; stage_id: string }> = [];
      let anyStageHasMore = false;

      for (const stage of stages) {
        const batch = messagePort.listMessages(stage.id, limit + 1, before_id);
        for (const msg of batch) {
          all.push({ message: msg, context: messagePort.getContext(msg.id), stage_id: stage.id });
        }
        if (batch.length > limit) anyStageHasMore = true;
      }

      all.sort((a, b) => b.message.id - a.message.id);
      const page = all.slice(0, limit);

      return {
        results: page.map((m) => ({
          message_id: m.message.id,
          stage_id: m.stage_id,
          from_speaker: m.message.from_speaker,
          content: m.context?.context ?? null,
          created_at: m.message.created_at,
        })),
        has_more: anyStageHasMore || all.length > limit,
      };
    },
  };
}

/** 按 ID 获取单条消息 */
function createGetMessageTool(messagePort: MessagePort): MCPTool {
  return {
    name: "get_message",
    description: "按 ID 获取单条消息及其内容。",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "number", description: "消息 ID" },
      },
      required: ["message_id"],
    },
    handler: async (params) => {
      const { message_id } = params as { message_id: number };
      const message = messagePort.getMessage(message_id);
      if (!message) {
        return { error: "Message not found" };
      }
      const context = messagePort.getContext(message_id);
      return {
        message_id: message.id,
        stage_id: message.stage_id,
        from_speaker: message.from_speaker,
        to_speakers: message.to_speakers,
        status: message.status,
        content: context?.context ?? null,
        created_at: message.created_at,
        ended_at: message.ended_at,
      };
    },
  };
}

/** 窗口查询：获取锚点消息前后的上下文 */
function createGetMessageWindowTool(stagePort: StagePort, messagePort: MessagePort): MCPTool {
  return {
    name: "get_message_window",
    description: "窗口查询。获取锚点消息所在 stage，返回锚点前 N 条 + 后 N 条消息。",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "number", description: "锚点消息 ID" },
        before: { type: "number", description: "锚点前的消息数量，默认 2" },
        after: { type: "number", description: "锚点后的消息数量，默认 2" },
      },
      required: ["message_id"],
    },
    handler: async (params) => {
      const { message_id, before = 2, after = 2 } = params as {
        message_id: number;
        before?: number;
        after?: number;
      };

      const anchor = messagePort.getMessage(message_id);
      if (!anchor) {
        return { error: "Anchor message not found" };
      }

      const windowMessages = messagePort.listMessagesWindow(anchor.stage_id, message_id, before, after);

      return {
        stage_id: anchor.stage_id,
        anchor_message_id: message_id,
        messages: windowMessages.map((msg) => ({
          message_id: msg.id,
          from_speaker: msg.from_speaker,
          content: messagePort.getContext(msg.id)?.context ?? null,
          created_at: msg.created_at,
          is_anchor: msg.id === message_id,
        })),
      };
    },
  };
}

/** 获取 Issue 的完整阶段历史链 */
function createGetStageHistoryTool(stagePort: StagePort, messagePort: MessagePort): MCPTool {
  return {
    name: "get_stage_history",
    description: "获取 Issue 的完整阶段历史链，包含每个阶段的元信息和最近消息。用于了解整体进展和前序阶段的关键决策。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID" },
        include_messages: { type: "boolean", description: "是否包含每个阶段的最近消息，默认 true" },
        messages_per_stage: { type: "number", description: "每个阶段返回的消息数量，默认 3" },
      },
      required: ["issue_id"],
    },
    handler: async (params) => {
      const { issue_id, include_messages = true, messages_per_stage = 3 } = params as {
        issue_id: string; include_messages?: boolean; messages_per_stage?: number;
      };

      const allStages = stagePort.listStages(issue_id);
      /** 找到当前 stage（left_at === null）作为回溯起点 */
      const currentStage = allStages.find(s => s.left_at === null);
      if (!currentStage) {
        return { stages: [], total_stages: 0 };
      }

      const chain = buildStageChain(allStages, currentStage.id);

      /** 在已构建的 chain 上 O(n) 检测重新进入：同一 key 出现过更早的实例 */
      const keyFirstSeen = new Map<string, string>();
      for (const s of chain) {
        if (!keyFirstSeen.has(s.key)) keyFirstSeen.set(s.key, s.id);
      }

      const stages = chain.map(s => {
        const isReEntry = keyFirstSeen.get(s.key) !== s.id;
        const entry: Record<string, unknown> = {
          stage_id: s.id,
          key: s.key,
          title: s.title,
          description: s.description,
          entered_at: s.entered_at,
          left_at: s.left_at,
          is_current: s.left_at === null,
          is_re_entry: isReEntry,
          output_artifacts: s.output_artifacts,
        };
        if (include_messages) {
          const messages = messagePort.listMessages(s.id, messages_per_stage);
          entry.messages = messages.map(msg => ({
            message_id: msg.id,
            from_speaker: msg.from_speaker,
            content: messagePort.getContext(msg.id)?.context ?? null,
            created_at: msg.created_at,
          }));
        }
        return entry;
      });

      return { stages, total_stages: chain.length };
    },
  };
}
