import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { MessagePort } from "@domain/message/port";
import { getLogger } from "@infra/logger";
const log = getLogger({ module: "snail-final-response" });

/**
 * snail-final-response MCP Server。
 * 用于 agent 提交消息的最终展示正文和路由目标声明。
 */
export function createFinalResponseServer(messagePort: MessagePort, mcpMessageStore: McpMessageStore): MCPServerConfig {
  /** 已提交 final body 的 message ID 集合，用于幂等防护（进程级生命周期） */
  const submittedMessages = new Set<number>();
  return {
    name: "snail-final-response",
    version: "1.0.0",
    tools: [
      {
        name: "set_final_body",
        description:
          "提交本次发言的最终答复正文。每次发言结束前必须调用此工具，" +
          "传入你希望展示给用户的完整 Markdown 内容。" +
          "调用后，此正文将作为消息的主要展示内容，流式过程中的中间分析会被折叠。" +
          "重要：调用此工具后，你的发言即告结束。不得再调用任何其他工具。",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "最终答复的 Markdown 正文" },
            message_id: { type: "string", description: "当前消息的 ID，通过环境变量 SNAIL_CTX_MESSAGE_ID 注入" },
            stage_id: { type: "string", description: "当前 stage 的 ID，通过环境变量 SNAIL_CTX_STAGE_ID 注入" },
            to_speakers: { type: "array", items: { type: "string" }, description: "路由目标（严格优先级最高）" },
          },
          required: ["text", "message_id", "stage_id"],
        },
        handler: async (params) => {
          const text = typeof params.text === "string" ? params.text : "";
          if (!text) throw new Error("text is required");
          const rawMessageId = params.message_id as string;
          if (!rawMessageId) throw new Error("message_id is required");
          const messageId = Number(rawMessageId);
          if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("message_id must be a positive integer");
          /** 归属校验：保留参数校验，即使重复调用也不静默吞掉错误 */
          const stageId = params.stage_id as string;
          if (stageId) {
            const message = messagePort.getMessage(messageId);
            if (!message) throw new Error(`message_id ${messageId} not found`);
            if (message.stage_id !== stageId) {
              throw new Error(`message_id ${messageId} does not belong to stage ${stageId} (actual: ${message.stage_id})`);
            }
          }
          /** 幂等防护：同一 message 重复调用时跳过所有写入，返回区分性响应 */
          if (submittedMessages.has(messageId)) {
            return { ok: true, already_submitted: true, hint: "final body already recorded for this message; your response is complete" };
          }
          messagePort.setContext(messageId, "mcp_final_body", text);
          /** 自动从 text 中提取 stage_transition 信号，注入为 signal 事件 */
          const stageTransition = extractStageTransition(text);
          if (stageTransition) {
            messagePort.appendEvent(messageId, {
              type: "signal",
              signal: "stage_transition",
              stage_transition: stageTransition,
            });
          }
          /** to_speakers 非空数组时写入 store；空数组视为"未指定"，不写入 */
          if (Array.isArray(params.to_speakers) && params.to_speakers.length > 0) {
            const targets = (params.to_speakers as unknown[]).filter((t): t is string => typeof t === "string");
            if (targets.length > 0) {
              mcpMessageStore.setMcpRoutingTargets(messageId, targets);
            }
          }
          submittedMessages.add(messageId);
          return { ok: true, proceed: "end_turn" };
        },
      },
    ],
  };
}

/**
 * 从 agent 输出文本中提取 stage_transition JSON。
 * agent 可能输出纯 JSON，也可能在 Markdown 中嵌入 JSON 块。
 * 解析失败时静默返回 null（agent 可能没有输出信号，这是正常情况）。
 */
function extractStageTransition(text: string): Record<string, unknown> | null {
  const direct = tryParseStageTransition(text);
  if (direct) return direct;
  const marker = '"stage_transition"';
  const markerIdx = text.indexOf(marker);
  if (markerIdx < 0) return null;
  const startIdx = text.lastIndexOf("{", markerIdx);
  if (startIdx < 0) return null;
  const endIdx = findMatchingBrace(text, startIdx);
  if (endIdx < 0) return null;
  return tryParseStageTransition(text.slice(startIdx, endIdx + 1));
}

function tryParseStageTransition(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as { stage_transition?: unknown };
    if (parsed?.stage_transition && typeof parsed.stage_transition === "object") return parsed.stage_transition as Record<string, unknown>;
  } catch {
    log.debug({ textLength: text.length }, "stage_transition.parse.skipped");
  }
  return null;
}

/** 从 startIdx 处的 { 开始，计数花括号找到匹配的 } 位置 */
function findMatchingBrace(text: string, startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
