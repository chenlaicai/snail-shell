import { SnailMCPServerAdapter } from "@domain/snail-mcp-server/_internal/adapter";
import { createFinalResponseServer } from "@domain/snail-mcp-server/_internal/servers/snail-final-response";
import { createEvolutionServer } from "@domain/snail-mcp-server/_internal/servers/evolution";
import { createKnowledgeServer } from "@domain/snail-mcp-server/_internal/servers/knowledge";
import { createRednoteResearchServer } from "@domain/snail-mcp-server/_internal/servers/rednote-research";
import { createSnailIssueContextServer } from "@domain/snail-mcp-server/_internal/servers/snail-issue-context";
import { createMessageHistoryServer } from "@domain/snail-mcp-server/_internal/servers/snail-message-history";
import { createFeatureChainServer } from "@domain/snail-mcp-server/_internal/servers/snail-feature-chain";
import { createIssueHierarchyServer } from "@domain/snail-mcp-server/_internal/servers/snail-issue-hierarchy";
import { createSopCreatorServer } from "@domain/snail-mcp-server/_internal/servers/snail-sop-creator";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { EvolutionPort } from "@domain/evolution/port";
import type { FeatureChainPort } from "@domain/feature-chain/port";
import type { SopPort } from "@domain/sop/port";
import type { Workspace } from "@domain/workspace/model";

/** Snail MCP Server 模块依赖 */
export interface SnailMCPServerDeps {
  /** evolution adapter（lazy，Proxy 代理） */
  evolution: EvolutionPort;
  /** knowledge adapter */
  knowledge: KnowledgePort;
  /** message adapter */
  message: MessagePort;
  /** issue adapter */
  issue: IssuePort;
  /** stage adapter */
  stage: StagePort;
  /** feature-chain adapter */
  featureChain: FeatureChainPort;
  /** MCP 路由目标 store（set_final_body 写入，collaboration resolveReplies 消费） */
  mcpMessageStore: McpMessageStore;
  /** SOP adapter */
  sop: SopPort;
  /** 工作区列表 */
  workspaces: Workspace[];
}

/**
 * 初始化 Snail MCP Server 模块。
 * 统一注册所有 Snail Shell 提供的 MCP Server。
 */
export function init(deps: SnailMCPServerDeps) {
  const adapter = new SnailMCPServerAdapter();

  // 注册所有 MCP Server
  adapter.registerServer(createFinalResponseServer(deps.message, deps.mcpMessageStore));
  adapter.registerServer(createEvolutionServer(deps.evolution));
  adapter.registerServer(createKnowledgeServer(deps.knowledge));
  adapter.registerServer(createRednoteResearchServer());
  adapter.registerServer(createSnailIssueContextServer(deps.issue));
  adapter.registerServer(createMessageHistoryServer(deps.stage, deps.message));
  adapter.registerServer(createFeatureChainServer(deps.featureChain));
  adapter.registerServer(createIssueHierarchyServer(deps.issue));
  adapter.registerServer(createSopCreatorServer(deps.sop, deps.workspaces));

  return { adapter };
}
