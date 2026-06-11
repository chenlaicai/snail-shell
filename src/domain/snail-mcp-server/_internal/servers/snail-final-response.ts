import type { MCPServerConfig } from "../../model";

/**
 * snail-final-response MCP Server。
 * 用于 agent 提交消息的最终展示正文。
 */
export function createFinalResponseServer(): MCPServerConfig {
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
          required: ["text", "conversation_id", "message_id"],
        },
        handler: async (params) => {
          // TODO: 实现 set_final_body 逻辑
          return { ok: true };
        },
      },
    ],
  };
}
