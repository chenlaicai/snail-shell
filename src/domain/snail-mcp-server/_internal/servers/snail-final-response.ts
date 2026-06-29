import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { MessagePort } from "@domain/message/port";

/**
 * snail-final-response MCP Server。
 * 用于 agent 提交消息的最终展示正文和路由目标声明。
 */
export function createFinalResponseServer(messagePort: MessagePort, mcpMessageStore: McpMessageStore): MCPServerConfig {
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
          /** 归属校验：message_id 必须属于当前 stage，防止串台写入 */
          const stageId = params.stage_id as string;
          if (stageId) {
            const message = messagePort.getMessage(messageId);
            if (!message) throw new Error(`message_id ${messageId} not found`);
            if (message.stage_id !== stageId) {
              throw new Error(`message_id ${messageId} does not belong to stage ${stageId} (actual: ${message.stage_id})`);
            }
          }
          messagePort.setContext(messageId, "mcp_final_body", text);
          /** to_speakers 非空数组时写入 store；空数组视为"未指定"，不写入 */
          if (Array.isArray(params.to_speakers) && params.to_speakers.length > 0) {
            const targets = (params.to_speakers as unknown[]).filter((t): t is string => typeof t === "string");
            if (targets.length > 0) {
              mcpMessageStore.setMcpRoutingTargets(messageId, targets);
            }
          }
          return { ok: true };
        },
      },
    ],
  };
}
