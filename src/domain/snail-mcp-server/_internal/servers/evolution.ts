import type { MCPServerConfig, MCPTool } from "@domain/snail-mcp-server/model";
import type { EvolutionPort } from "@domain/evolution/port";
import type { CreateEvolutionItemInput } from "@domain/evolution/model";

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
    description: "创建演进候选项。此 tool 仅创建 evolution_item 记录（状态为 Candidate）。治理对话的 Issue/Stage/Conversation 由治理流程创建，不由本 tool 创建。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "演进项标题" },
        content: { type: "string", description: "演进项内容（Markdown）" },
        workspace_id: { type: "string", description: "工作区 ID" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表（可选）" },
        metadata: { description: "元数据（可选）" },
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
