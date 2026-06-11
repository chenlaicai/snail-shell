import { SnailMCPServerAdapter } from "./adapter";
import { createFinalResponseServer } from "./servers/snail-final-response";
import { createEvolutionServer } from "./servers/evolution";
import { createKnowledgeServer } from "./servers/knowledge";
import type { KnowledgeMCPPort } from "@domain/knowledge-mcp/port";

/** Snail MCP Server 模块依赖 */
export interface SnailMCPServerDeps {
  /** evolution adapter 的 updateStatus 方法 */
  evolutionUpdateStatus: (id: string, status: string, result?: string) => Promise<{ id: string; status: string }>;
  /** knowledge MCP adapter */
  knowledge: KnowledgeMCPPort;
}

/**
 * 初始化 Snail MCP Server 模块。
 * 统一注册所有 Snail Shell 提供的 MCP Server。
 */
export function init(deps: SnailMCPServerDeps) {
  const adapter = new SnailMCPServerAdapter();

  // 注册所有 MCP Server
  adapter.registerServer(createFinalResponseServer());
  adapter.registerServer(createEvolutionServer(deps.evolutionUpdateStatus));
  adapter.registerServer(createKnowledgeServer(deps.knowledge));

  return { adapter };
}
