import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { StagePort } from "@domain/issue/port";
import type { MessagePort } from "@domain/message/port";
import type { Message, MessageContext } from "@domain/message/model";

/**
 * snail-message-history MCP Server。
 * 替代旧 conversation-history skill，提供跨 stage 的消息查询能力。
 *
 * @param stagePort Stage adapter
 * @param messagePort Message adapter
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
    ],
  };
}

/** 分页获取某个 stage 的全部消息（绕过 listMessages 的默认 limit） */
function fetchAllStageMessages(messagePort: MessagePort, stageId: string, batchSize = 100): Message[] {
  const all: Message[] = [];
  let beforeId: number | undefined;
  while (true) {
    const batch = messagePort.listMessages(stageId, batchSize, beforeId);
    if (batch.length === 0) break;
    all.push(...batch);
    beforeId = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }
  return all;
}

/** 跨 stage 关键词搜索 */
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
      const results: Array<{ message: Message; context: MessageContext | null; stage_id: string }> = [];

      for (const stage of stages) {
        if (results.length >= limit) break;

        const messages = fetchAllStageMessages(messagePort, stage.id);
        for (const msg of messages) {
          if (results.length >= limit) break;

          // 获取消息内容进行关键词匹配
          const context = messagePort.getContext(msg.id);
          if (context && context.context.toLowerCase().includes(query.toLowerCase())) {
            results.push({ message: msg, context, stage_id: stage.id });
          }
        }
      }

      return {
        results: results.map((r) => ({
          message_id: r.message.id,
          stage_id: r.stage_id,
          from_speaker: r.message.from_speaker,
          content: r.context?.context ?? null,
          created_at: r.message.created_at,
        })),
        total: results.length,
      };
    },
  };
}

type StageMessage = { message: Message; context: MessageContext | null; stage_id: string };

function collectWithFetch(messagePort: MessagePort, stages: Array<{ id: string }>, fetch: (port: MessagePort, id: string) => Message[]): StageMessage[] {
  const all: StageMessage[] = [];
  for (const stage of stages) {
    for (const msg of fetch(messagePort, stage.id)) {
      all.push({ message: msg, context: messagePort.getContext(msg.id), stage_id: stage.id });
    }
  }
  all.sort((a, b) => b.message.id - a.message.id);
  return all;
}

function formatMessage(m: StageMessage) {
  return { message_id: m.message.id, stage_id: m.stage_id, from_speaker: m.message.from_speaker, content: m.context?.context ?? null, created_at: m.message.created_at };
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
        const fetch = (port: MessagePort, id: string) => port.listMessages(id, limit);
        const trimmed = collectWithFetch(messagePort, stages, fetch).slice(0, limit);
        const byStage = new Map<string, StageMessage[]>();
        for (const item of trimmed) {
          let arr = byStage.get(item.stage_id);
          if (!arr) { arr = []; byStage.set(item.stage_id, arr); }
          arr.push(item);
        }
        return { results: [...byStage.entries()].map(([stage_id, items]) => ({ stage_id, messages: items.map(formatMessage) })) };
      }

      // page 模式：全量聚合分页
      const allMessages = collectWithFetch(messagePort, stages, fetchAllStageMessages);
      const filtered = before_id !== undefined ? allMessages.filter((m) => m.message.id < before_id) : allMessages;
      return { results: filtered.slice(0, limit).map(formatMessage), has_more: filtered.length > limit };
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

      // 获取锚点消息
      const anchor = messagePort.getMessage(message_id);
      if (!anchor) {
        return { error: "Anchor message not found" };
      }

      // 获取锚点所在 stage 的所有消息
      const stageMessages = messagePort.listMessages(anchor.stage_id, 100);

      // 找到锚点在列表中的位置
      const anchorIndex = stageMessages.findIndex((m) => m.id === message_id);
      if (anchorIndex === -1) {
        return { error: "Anchor message not found in stage" };
      }

      // 取窗口范围
      const start = Math.max(0, anchorIndex - before);
      const end = Math.min(stageMessages.length, anchorIndex + after + 1);
      const windowMessages = stageMessages.slice(start, end);

      return {
        stage_id: anchor.stage_id,
        anchor_message_id: message_id,
        messages: windowMessages.map((msg) => {
          const context = messagePort.getContext(msg.id);
          return {
            message_id: msg.id,
            from_speaker: msg.from_speaker,
            content: context?.context ?? null,
            created_at: msg.created_at,
            is_anchor: msg.id === message_id,
          };
        }),
      };
    },
  };
}
