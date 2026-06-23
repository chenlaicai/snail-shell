import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { MessagePort } from "@domain/message/port";
import type { StagePort } from "@domain/issue/port";

/**
 * 从环境变量中读取当前协作上下文。
 *
 * 这些变量由 collaboration 层通过 buildContextEnv 注入到 agent 进程中，
 * key 为 SNAIL_CTX_* 格式（见 context-keys.ts）。
 */
function readContextFromEnv(): { stageId: string; messageId: number } {
  const stageId = process.env.SNAIL_CTX_STAGE_ID ?? "";
  const messageIdStr = process.env.SNAIL_CTX_MESSAGE_ID ?? "";
  const messageId = Number(messageIdStr);
  if (!stageId) throw new Error("SNAIL_CTX_STAGE_ID not found in environment");
  if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("SNAIL_CTX_MESSAGE_ID not found or invalid in environment");
  return { stageId, messageId };
}

function createSendMessageTool(messagePort: MessagePort, stagePort: StagePort): MCPTool {
  return {
    name: "send_message",
    description:
      "发送消息并触发目标角色回应。同时设置消息的最终展示正文（等同于 set_final_body + 路由）。" +
      "当你只需要展示结果而不需要触发他人时，使用 set_final_body。",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "目标角色实例名列表（如 ['开发者', 'user']）。可用值见 system-reminder 中的角色列表。",
        },
        text: { type: "string", description: "消息正文（Markdown），同时作为最终展示内容" },
      },
      required: ["to", "text"],
    },
    handler: async (params) => {
      const text = typeof params.text === "string" ? params.text : "";
      if (!text) throw new Error("text is required");

      const to = params.to;
      if (!Array.isArray(to) || to.length === 0) throw new Error("to must be a non-empty array of role instance names");
      const toSpeakers = to.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (toSpeakers.length === 0) throw new Error("to must contain at least one valid role instance name");

      const { stageId, messageId } = readContextFromEnv();

      // 校验目标角色是否为合法实例
      const stage = stagePort.findStage(stageId);
      if (!stage) throw new Error(`Stage not found: ${stageId}`);
      const validSpeakers = new Set([...stage.role_instances, "user"]);
      const invalidSpeakers = toSpeakers.filter(s => !validSpeakers.has(s));
      if (invalidSpeakers.length > 0) {
        throw new Error(`Invalid target speakers: ${invalidSpeakers.join(", ")}. Valid: ${[...validSpeakers].join(", ")}`);
      }

      messagePort.setContext(messageId, "send_message_body", text);
      messagePort.updateMessageTargets(messageId, toSpeakers);
      for (const speaker of toSpeakers) {
        messagePort.createCallSignal(stageId, speaker);
      }

      return { ok: true, to: toSpeakers };
    },
  };
}

function createSuggestStageTransitionTool(stagePort: StagePort): MCPTool {
  return {
    name: "suggest_stage_transition",
    description:
      "建议从当前阶段流转到目标阶段。需要用户确认后才会实际执行。" +
      "目标 key 必须是 system-reminder 中「可用流转」列出的值。",
    inputSchema: {
      type: "object",
      properties: {
        target_key: { type: "string", description: "目标阶段 key" },
        reason: { type: "string", description: "建议流转的原因" },
        guard: { type: "string", description: "对 guard 条件的满足情况说明" },
      },
      required: ["target_key", "reason"],
    },
    handler: async (params) => {
      const targetKey = typeof params.target_key === "string" ? params.target_key : "";
      const reason = typeof params.reason === "string" ? params.reason : "";
      if (!targetKey) throw new Error("target_key is required");
      if (!reason) throw new Error("reason is required");

      const { stageId } = readContextFromEnv();
      const stage = stagePort.findStage(stageId);
      if (!stage) throw new Error(`Stage not found: ${stageId}`);

      const transition = stage.available_transitions.find(t => t.to === targetKey);
      if (!transition) {
        throw new Error(`Transition to "${targetKey}" not available from stage "${stage.key}". Available: ${stage.available_transitions.map(t => t.to).join(", ")}`);
      }

      return {
        ok: true,
        stage_transition: {
          target_key: targetKey,
          reason,
          guard: typeof params.guard === "string" ? params.guard : transition.guard,
        },
      };
    },
  };
}

function createQueryContextTool(stagePort: StagePort): MCPTool {
  return {
    name: "query_context",
    description:
      "查询当前协作上下文：角色列表、可用流转、产物等。" +
      "仅在需要确认实时状态时使用（system-reminder 中已有静态快照）。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          enum: ["roles", "transitions", "artifacts", "all"],
          description: "要查询的信息类型",
        },
      },
      required: ["query"],
    },
    handler: async (params) => {
      const query = typeof params.query === "string" ? params.query : "all";
      const { stageId } = readContextFromEnv();
      const stage = stagePort.findStage(stageId);
      if (!stage) throw new Error(`Stage not found: ${stageId}`);

      const roles = stage.role_instances;
      const transitions = stage.available_transitions.map(t => ({ target_key: t.to, guard: t.guard }));
      const artifacts = stage.output_artifacts;

      switch (query) {
        case "roles":
          return { roles, default_role: stage.default_role_instance };
        case "transitions":
          return { transitions };
        case "artifacts":
          return { artifacts };
        default:
          return { stage_key: stage.key, stage_title: stage.title, roles, default_role: stage.default_role_instance, transitions, artifacts };
      }
    },
  };
}

/**
 * snail-collaboration MCP Server。
 *
 * 提供结构化协作工具，替代文本中的 @mention 模式匹配和 JSON.parse hack。
 */
export function createCollaborationServer(messagePort: MessagePort, stagePort: StagePort): MCPServerConfig {
  return {
    name: "snail-collaboration",
    version: "1.0.0",
    tools: [
      createSendMessageTool(messagePort, stagePort),
      createSuggestStageTransitionTool(stagePort),
      createQueryContextTool(stagePort),
    ],
  };
}
