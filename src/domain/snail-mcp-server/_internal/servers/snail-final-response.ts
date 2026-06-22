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
        description: "设置消息的最终展示正文（Markdown）",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "最终 Markdown 正文" },
            conversation_id: { type: "string" },
            message_id: { type: "string" },
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
