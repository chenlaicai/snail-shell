import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import type { StageTransitionPort } from "@domain/snail-mcp-server/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "snail-stage-transition" });

/**
 * 阶段推进 MCP Server。提供 request_stage_transition 工具，
 * 让 agent 请求推进到下一阶段。校验通过后信号被持久化，进入自动推进评估流程。
 */
export function createStageTransitionServer(stageTransitionPort: StageTransitionPort): MCPServerConfig {
  return {
    name: "snail-stage-transition",
    version: "1.0.0",
    tools: [
      {
        name: "request_stage_transition",
        description:
          "请求推进到下一阶段。完成 Stage Gate 自检后调用此工具，系统会校验推进条件并注册信号。" +
          "校验通过后信号被持久化，进入自动推进评估流程。",
        inputSchema: {
          type: "object",
          properties: {
            stage_id: { type: "string", description: "当前 stage 的 ID，通过环境变量 SNAIL_CTX_STAGE_ID 注入" },
            target_key: { type: "string", description: "目标阶段 key" },
            reason: { type: "string", description: "推进理由和自检证据（自然语言）" },
            signal_type: { type: "string", enum: ["gate_complete", "adversarial_consensus", "disagreement"], description: "信号类型（可选，默认从 stage config 推断；disagreement 时需显式指定）" },
            from_speaker: { type: "string", description: "当前 agent 的角色实例名，从 identity 块的角色实例字段提取" },
          },
          required: ["stage_id", "target_key", "reason", "from_speaker"],
        },
        handler: async (params) => {
          const stageId = params.stage_id as string;
          if (!stageId) throw new Error("stage_id is required");
          const fromSpeaker = params.from_speaker as string;
          if (!fromSpeaker) throw new Error("from_speaker is required");
          const targetKey = params.target_key as string;
          if (!targetKey) throw new Error("target_key is required");
          const reason = params.reason as string;
          if (!reason) throw new Error("reason is required");

          const result = await stageTransitionPort.requestTransition({
            stageId,
            fromSpeaker,
            targetKey,
            signalType: params.signal_type as string | undefined,
            reason,
          });

          log.info({ stageId, fromSpeaker, targetKey, valid: result.valid }, "request_stage_transition");

          return result;
        },
      },
    ],
  };
}
