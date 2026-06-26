import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";

/**
 * MCP set_final_body 声明的 to_speakers 暂存区。
 * 生命周期：set_final_body 写入 → invokeAgent 完成后读取并删除。
 * collaboration 层从这里读取 MCP 声明的路由目标，与文本 @mentions 合并后写入 message.to_speakers。
 */
export const mcpToSpeakersStore = new Map<number, string[]>();

/**
 * snail-final-response MCP Server。
 * 用于 agent 提交消息的最终展示正文。
 */
export function createFinalResponseServer(messagePort: MessagePort, stagePort: StagePort): MCPServerConfig {
  return {
    name: "snail-final-response",
    version: "1.0.0",
    tools: [
      createGetCurrentMessageIdTool(messagePort, stagePort),
      createSetFinalBodyTool(messagePort),
    ],
  };
}

function createGetCurrentMessageIdTool(messagePort: MessagePort, stagePort: StagePort) {
  return {
    name: "get_current_message_id",
    description:
      "获取当前 streaming message 的 ID。在调用 set_final_body 前先调用此工具获取正确的 message_id。",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID，从 SNAIL_CTX_issue_id 环境变量获取" },
      },
      required: ["issue_id"],
    },
    handler: async (params: Record<string, unknown>) => {
      const issueId = typeof params.issue_id === "string" ? params.issue_id : "";
      if (!issueId) throw new Error("issue_id is required");

      /** 遍历 issue 的所有 stage，找到最新的 streaming message */
      const stages = stagePort.listStages(issueId);
      let latestStreaming: { id: number; created_at: string } | undefined;
      for (const stage of stages) {
        const messages = messagePort.listMessages(stage.id);
        for (const msg of messages) {
          if (msg.status === "streaming" && (!latestStreaming || msg.id > latestStreaming.id)) {
            latestStreaming = { id: msg.id, created_at: msg.created_at };
          }
        }
      }

      if (!latestStreaming) throw new Error("No active streaming message found");
      return { message_id: latestStreaming.id };
    },
  };
}

function createSetFinalBodyTool(messagePort: MessagePort) {
  return {
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
        message_id: { type: "string", description: "当前消息的 ID，通过环境变量 message_id 注入" },
        to_speakers: {
          type: "array",
          items: { type: "string" },
          description: "路由目标角色列表，如 [\"开发者\", \"审查者\"]",
        },
      },
      required: ["text", "message_id", "to_speakers"],
    },
    handler: async (params: Record<string, unknown>) => {
      const text = typeof params.text === "string" ? params.text : "";
      const messageId = Number(params.message_id);
      if (!text) throw new Error("text is required");
      if (!Number.isInteger(messageId) || messageId <= 0) {
        throw new Error("message_id must be a positive integer (call get_current_message_id first)");
      }

      const toSpeakers = params.to_speakers;
      if (!Array.isArray(toSpeakers) || toSpeakers.length === 0) {
        throw new Error("to_speakers is required and must be a non-empty array");
      }
      const validSpeakers = toSpeakers.filter((s): s is string => typeof s === "string" && s.length > 0);
      if (validSpeakers.length === 0) throw new Error("to_speakers must contain at least one non-empty string");

      messagePort.setContext(messageId, "mcp_final_body", text);
      mcpToSpeakersStore.set(messageId, validSpeakers);
      return { ok: true };
    },
  };
}
