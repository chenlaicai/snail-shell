import type { MCPServerConfig } from "@domain/snail-mcp-server/model";

import type { MessagePort } from "@domain/message/port";

/**
 * snail-final-response MCP Server。
 * 用于 agent 提交消息的最终展示正文。
 */
export function createFinalResponseServer(messagePort: MessagePort): MCPServerConfig {
  return {
    name: "snail-final-response",
    version: "1.0.0",
    tools: [
      {
        name: "set_final_body",
        description:
          "提交本次发言的最终答复正文。每次发言结束前必须调用此工具，" +
          "传入你希望展示给用户的完整 Markdown 内容。" +
          "调用后，此正文将作为消息的主要展示内容，流式过程中的中间分析会被折叠。",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "最终答复的 Markdown 正文" },
            conversation_id: { type: "string" },
            message_id: { type: "string", description: "从 system-reminder 的 <context> 中获取" },
          },
          required: ["text", "message_id"],
        },
        handler: async (params) => {
          const text = typeof params.text === "string" ? params.text : "";
          const messageId = Number(params.message_id);
          if (!text) throw new Error("text is required");
          if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("message_id must be a positive integer");
          messagePort.setContext(messageId, "mcp_final_body", text);
          return { ok: true };
        },
      },
    ],
  };
}
