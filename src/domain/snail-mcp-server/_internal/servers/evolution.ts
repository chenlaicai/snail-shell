import type { MCPServerConfig } from "@domain/snail-mcp-server/model";

/**
 * snail-evolution MCP Server。
 * 用于 agent 在演进治理对话中回写处理结果。
 *
 * @param updateEvolution evolution adapter 的 update 方法
 */
export function createEvolutionServer(
  updateEvolution: (id: string, updates: { status?: string; result?: string }) => Promise<{ id: string; status: string }>,
): MCPServerConfig {
  return {
    name: "snail-evolution",
    version: "1.0.0",
    tools: [
      {
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
          const item = await updateEvolution(evolution_item_id, { status: "completed", result });
          return { ok: true, item_id: item.id, status: item.status };
        },
      },
    ],
  };
}
