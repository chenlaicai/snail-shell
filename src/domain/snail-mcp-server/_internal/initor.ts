import { SnailMCPServerAdapter } from "@domain/snail-mcp-server/_internal/adapter";
import { createFinalResponseServer } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import { createEvolutionServer } from "@domain/snail-mcp-server/_internal/servers/evolution";
import { createKnowledgeServer } from "@domain/snail-mcp-server/_internal/servers/knowledge";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { MessagePort } from "@domain/message/port";

/** Snail MCP Server 模块依赖 */
export interface SnailMCPServerDeps {
  /** evolution adapter 的 update 方法 */
  updateEvolution: (id: string, updates: { status?: string; result?: string }) => Promise<{ id: string; status: string }>;
  /** knowledge adapter */
  knowledge: KnowledgePort;
  /** message adapter */
  message: MessagePort;
}

/**
 * 初始化 Snail MCP Server 模块。
 * 统一注册所有 Snail Shell 提供的 MCP Server。
 */
export function init(deps: SnailMCPServerDeps) {
  const adapter = new SnailMCPServerAdapter();

  // 注册所有 MCP Server
  adapter.registerServer(createFinalResponseServer(deps.message));
  adapter.registerServer(createEvolutionServer(deps.updateEvolution));
  adapter.registerServer(createKnowledgeServer(deps.knowledge));

  return { adapter };
}
