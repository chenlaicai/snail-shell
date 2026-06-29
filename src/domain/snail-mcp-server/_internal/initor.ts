import { SnailMCPServerAdapter } from "@domain/snail-mcp-server/_internal/adapter";
import { createFinalResponseServer } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import { createEvolutionServer } from "@domain/snail-mcp-server/_internal/servers/evolution";
import { createKnowledgeServer } from "@domain/snail-mcp-server/_internal/servers/knowledge";
import { createRednoteResearchServer } from "@domain/snail-mcp-server/_internal/servers/rednote-research";
import { createSnailIssueContextServer } from "@domain/snail-mcp-server/_internal/servers/snail-issue-context";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort } from "@domain/issue/port";

/** Snail MCP Server 模块依赖 */
export interface SnailMCPServerDeps {
  /** evolution adapter 的 update 方法 */
  updateEvolution: (id: string, updates: { status?: string; result?: string }) => Promise<{ id: string; status: string }>;
  /** knowledge adapter */
  knowledge: KnowledgePort;
  /** message adapter */
  message: MessagePort;
  /** issue adapter */
  issue: IssuePort;
  /** MCP 路由目标 store（set_final_body 写入，collaboration resolveReplies 消费） */
  mcpMessageStore: McpMessageStore;
}

/**
 * 初始化 Snail MCP Server 模块。
 * 统一注册所有 Snail Shell 提供的 MCP Server。
 */
export function init(deps: SnailMCPServerDeps) {
  const adapter = new SnailMCPServerAdapter();

  // 注册所有 MCP Server
  adapter.registerServer(createFinalResponseServer(deps.message, deps.mcpMessageStore));
  adapter.registerServer(createEvolutionServer(deps.updateEvolution));
  adapter.registerServer(createKnowledgeServer(deps.knowledge));
  adapter.registerServer(createRednoteResearchServer());
  adapter.registerServer(createSnailIssueContextServer(deps.issue));

  return { adapter };
}
