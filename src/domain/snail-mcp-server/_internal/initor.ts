import { SnailMCPServerAdapter } from "./adapter";
import { createFinalResponseServer } from "./servers/snail-final-response";
import { createEvolutionServer } from "./servers/evolution";
import { createKnowledgeServer } from "./servers/knowledge";
import type { KnowledgePort } from "@domain/knowledge/port";

/** Snail MCP Server 模块依赖 */
export interface SnailMCPServerDeps {
  /** evolution adapter 的 update 方法 */
  updateEvolution: (id: string, updates: { status?: string; result?: string }) => Promise<{ id: string; status: string }>;
  /** knowledge adapter */
  knowledge: KnowledgePort;
}

/**
 * 初始化 Snail MCP Server 模块。
 * 统一注册所有 Snail Shell 提供的 MCP Server。
 */
export function init(deps: SnailMCPServerDeps) {
  const adapter = new SnailMCPServerAdapter();

  // 注册所有 MCP Server
  adapter.registerServer(createFinalResponseServer());
  adapter.registerServer(createEvolutionServer(deps.updateEvolution));
  adapter.registerServer(createKnowledgeServer(deps.knowledge));

  return { adapter };
}
