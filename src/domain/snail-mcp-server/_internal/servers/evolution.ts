import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { EvolutionPort } from "@domain/evolution/port";
import type { CreateEvolutionItemInput } from "@domain/evolution/model";

/** 自动创建时允许的反馈信号类型 */
const TRIGGER_REASONS = [
  "user_dissatisfied",
  "user_confused",
  "user_corrected",
  "repeat_problem",
  "feature_missing",
  "tool_friction",
] as const;

type TriggerReason = (typeof TRIGGER_REASONS)[number];

function isTriggerReason(value: string): value is TriggerReason {
  return (TRIGGER_REASONS as readonly string[]).includes(value);
}

/**
 * 校验 metadata 中的 auto_generation 结构。
 * 仅在 metadata 包含 auto_generation 时校验；无 auto_generation 时视为手动创建，跳过校验。
 */
function validateAutoGeneration(metadata: unknown): void {
  if (metadata == null || typeof metadata !== "object") return;
  const meta = metadata as Record<string, unknown>;
  if (!("auto_generation" in meta)) return;

  const ag = meta.auto_generation;
  if (ag == null || typeof ag !== "object") {
    throw new Error("metadata.auto_generation must be an object");
  }
  const agObj = ag as Record<string, unknown>;

  if (agObj.source_type !== "auto") {
    throw new Error('metadata.auto_generation.source_type must be "auto"');
  }
  if (typeof agObj.trigger_reason !== "string" || !isTriggerReason(agObj.trigger_reason)) {
    throw new Error(`metadata.auto_generation.trigger_reason must be one of: ${TRIGGER_REASONS.join(", ")}`);
  }
  if (typeof agObj.related_message_id !== "number") {
    throw new Error("metadata.auto_generation.related_message_id must be a number");
  }
  if (typeof agObj.related_issue_id !== "string") {
    throw new Error("metadata.auto_generation.related_issue_id must be a string");
  }
  if (typeof agObj.related_stage_id !== "string") {
    throw new Error("metadata.auto_generation.related_stage_id must be a string");
  }
}

/**
 * snail-evolution MCP Server。
 * 用于 agent 在演进治理对话中回写处理结果，以及创建演进候选。
 *
 * @param evolution EvolutionPort adapter
 */
export function createEvolutionServer(evolution: EvolutionPort): MCPServerConfig {
  return {
    name: "snail-evolution",
    version: "1.0.0",
    tools: [
      createCompleteEvolutionItemTool(evolution),
      createCreateCandidateTool(evolution),
    ],
  };
}

/** 完成演进项处理 */
function createCompleteEvolutionItemTool(evolution: EvolutionPort): MCPTool {
  return {
    name: "complete_evolution_item",
    description: "完成演进项处理，回写结果摘要。在演进治理对话结束前调用。",
    inputSchema: {
      type: "object",
      properties: {
        evolution_item_id: { type: "string", description: "演进项 ID（从 system prompt 的 Evolution Item ID 获取）" },
        result: { type: "string", description: "处理结果摘要（Markdown）" },
      },
      required: ["evolution_item_id", "result"],
    },
    handler: async (params) => {
      const { evolution_item_id, result } = params as { evolution_item_id: string; result: string };
      const item = evolution.update(evolution_item_id, { status: "completed", result });
      return { ok: true, item_id: item.id, status: item.status };
    },
  };
}

/** 创建演进候选 */
function createCreateCandidateTool(evolution: EvolutionPort): MCPTool {
  return {
    name: "create_candidate",
    description: "创建演进候选项。当在对话中识别到以下反馈信号时使用：\n- 用户不满：明确表达对系统行为的不满意、生气、失望\n- 用户困惑：表示不理解、困惑、不清楚\n- 用户纠正：纠正你的行为或输出\n- 重复问题：同一问题反复提出（第三次及以上）\n- 功能缺失：期望的功能不存在（多次出现或明确影响工作流）\n- 工具使用体验不佳：agent 在使用系统提供的 skill/MCP/功能时，发现操作不便、流程冗余、参数缺失或语义不清\n\n不应创建的情况：\n- 当前 issue 正在处理的问题本身（条目应指向系统改进点，而非复述问题）\n- 审美偏好、首次 feature request、随口建议、与系统无关的抱怨\n\n创建前判断：改进点必须超出当前 issue 范围、指向系统层面（prompt/skill/SOP/code/知识库）、且具有复用价值。任一不满足则不创建。\n\n内容要求：\n- title：系统改进点简述（如\"review skill 应增加 XX 检查\"而非\"XX 问题\"）\n- content：改进方向 + 触发场景 + 建议落点，必须回答\"系统的哪个部分需要怎样改变\"\n\n执行步骤：先搜索已有条目判断重复 → 不重复则调用本工具（metadata 带 auto_generation）→ 回复中说明已记录 → 继续正常回复\n\n此 tool 仅创建 evolution_item 记录（状态为 Candidate）。治理对话的 Issue/Stage/Conversation 由治理流程创建，不由本 tool 创建。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "系统改进点简述（如'review skill 应增加 XX 检查'而非'XX 问题'）" },
        content: { type: "string", description: "改进方向 + 触发场景 + 建议落点。必须回答'系统的哪个部分需要怎样改变'" },
        workspace_id: { type: "string", description: "工作区 ID" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表（可选）" },
        metadata: {
          type: "object",
          description: "元数据（可选）。手动创建时不传；自动创建时需包含 auto_generation 结构",
          properties: {
            auto_generation: {
              type: "object",
              description: "自动创建时的上下文信息（仅 agent 自动识别反馈信号时填写）",
              properties: {
                source_type: { type: "string", const: "auto", description: '固定为 "auto"' },
                trigger_reason: { type: "string", enum: [...TRIGGER_REASONS], description: "反馈信号类型" },
                related_message_id: { type: "number", description: "触发反馈的用户消息 ID" },
                related_issue_id: { type: "string", description: "触发反馈的 issue ID" },
                related_stage_id: { type: "string", description: "触发反馈的 stage ID" },
              },
              required: ["source_type", "trigger_reason", "related_message_id", "related_issue_id", "related_stage_id"],
            },
          },
        },
      },
      required: ["title", "content", "workspace_id"],
    },
    handler: async (params) => {
      const { title, content, workspace_id, tags, metadata } = params as {
        title: string;
        content: string;
        workspace_id: string;
        tags?: string[];
        metadata?: unknown;
      };
      validateAutoGeneration(metadata);
      const input: CreateEvolutionItemInput = {
        title,
        content,
        workspace_id,
        tags: tags ?? [],
        metadata,
      };
      const item = evolution.create(input);
      return {
        ok: true,
        item_id: item.id,
        status: item.status,
        title: item.title,
      };
    },
  };
}
