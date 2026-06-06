/**
 * MCP 工具定义和 handler。
 *
 * Snail Shell 暴露给 agent 的 MCP 工具：
 * - set_final_body：agent 显式声明消息的最终展示正文
 */

import type { ConversationStore } from "../persistence/store";

export const MCP_TOOLS = [
  {
    name: "set_final_body",
    description:
      "设置当前消息的最终展示正文。当你完成分析、准备向用户展示最终结果时调用此工具。" +
      "调用后，你的最终正文将替代流式过程作为消息的主要展示内容，" +
      "流式过程中的中间分析将被折叠。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "最终展示给用户的正文内容（支持 Markdown）" },
        conversation_id: { type: "string", description: "当前对话 ID，从系统提示词中的 <mcp_context> 获取" },
        message_id: { type: "string", description: "当前消息 ID，从系统提示词中的 <mcp_context> 获取" },
      },
      required: ["text", "conversation_id", "message_id"],
    },
  },
];

export const MCP_SERVER_INFO = { name: "snail-final-response", version: "1.0.0" };

type McpResult = { content: Array<{ type: "text"; text: string }> };

function mcpError(message: string): McpResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
}

/**
 * 校验 set_final_body 调用参数，返回错误信息或解析后的值。
 * 提取为独立函数以降低 handleMcpToolCall 圈复杂度。
 */
function validateFinalBodyArgs(
  store: ConversationStore,
  params: Record<string, unknown>,
): { error: string } | { text: string; conversationId: string; messageId: string } {
  if (params.name !== "set_final_body") {
    return { error: `Unknown tool: ${params.name}` };
  }

  const args = (params.arguments ?? {}) as Record<string, unknown>;
  /** trim 仅用于空值校验；存储时保留原文，不破坏 agent 输出的格式（如前导空行、缩进） */
  const text = typeof args.text === "string" ? args.text.trim() : "";
  const conversationId = typeof args.conversation_id === "string" ? args.conversation_id : "";
  const messageId = typeof args.message_id === "string" ? args.message_id : "";

  if (!text) return { error: "text is required and must be non-empty" };
  /** 前置校验：比 getMessage 更早报出明确错误，避免 NPE 或混淆性错误信息 */
  if (!conversationId || !messageId) return { error: "conversation_id and message_id are required" };

  /** 验证 message 是否属于指定 conversation，防止跨会话/跨消息污染 */
  if (!store.getMessage(Number(messageId), conversationId)) {
    return { error: "message_id does not belong to conversation_id" };
  }

  return { text, conversationId, messageId };
}

export function handleMcpToolCall(store: ConversationStore, params: unknown): McpResult {
  /** MCP endpoint 层已保证 params 为 JSON.parse 后的对象，此处 cast 安全 */
  const p = params as Record<string, unknown> | null | undefined;
  if (!p || typeof p.name !== "string") return mcpError("Invalid params");

  const validated = validateFinalBodyArgs(store, p);
  if ("error" in validated) return mcpError(validated.error);

  try {
    store.upsertMessageContext(Number(validated.messageId), "mcp_final_body", validated.text);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  } catch (err) {
    return mcpError(err instanceof Error ? err.message : String(err));
  }
}
