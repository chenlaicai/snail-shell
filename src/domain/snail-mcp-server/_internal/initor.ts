import { SnailMCPServerAdapter } from "@domain/snail-mcp-server/_internal/adapter";
import { createIssueServer, type IssueServerDeps } from "@domain/snail-mcp-server/_internal/servers/snail-issue";
import { createKnowledgeServer } from "@domain/snail-mcp-server/_internal/servers/knowledge";
import { createRednoteResearchServer } from "@domain/snail-mcp-server/_internal/servers/rednote-research";
import type { KnowledgePort } from "@domain/knowledge/port";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { EvolutionPort } from "@domain/evolution/port";
import type { SQLiteDatabase } from "@infra/database";

/** Snail MCP Server 模块依赖 */
export interface SnailMCPServerDeps {
  /** knowledge adapter */
  knowledge: KnowledgePort;
  /** message adapter */
  message: MessagePort;
  /** issue adapter */
  issue: IssuePort;
  /** stage adapter */
  stage: StagePort;
  /** database (for complex queries) */
  db: SQLiteDatabase;
  /** evolution adapter (deferred via ref) */
  evolutionRef: { current?: EvolutionPort };
  /** create evolution candidate with issue (deferred via ref) */
  createEvolutionCandidateRef: { current?: IssueServerDeps["createEvolutionCandidate"] };
  /** query conversation context (deferred via ref) */
  queryConversationContextRef: { current?: IssueServerDeps["queryConversationContext"] };
  /** query conversation history (deferred via ref) */
  queryConversationHistoryRef: { current?: IssueServerDeps["queryConversationHistory"] };
  /** search feature chain (deferred via ref) */
  searchFeatureChainRef: { current?: IssueServerDeps["searchFeatureChain"] };
}

/**
 * 初始化 Snail MCP Server 模块。
 * 统一注册所有 Snail Shell 提供的 MCP Server。
 */
export function init(deps: SnailMCPServerDeps) {
  const adapter = new SnailMCPServerAdapter();

  // Register snail-issue server with deferred deps
  adapter.registerServer(createIssueServer({
    message: deps.message,
    stage: deps.stage,
    issue: deps.issue,
    updateEvolution: async (id, updates) => {
      if (!deps.evolutionRef.current) throw new Error("Evolution module is not initialized");
      const item = deps.evolutionRef.current.update(id, updates);
      return { id: item.id, status: item.status };
    },
    queryConversationContext: (conversationId) => {
      if (!deps.queryConversationContextRef.current) throw new Error("queryConversationContext is not initialized");
      return deps.queryConversationContextRef.current(conversationId);
    },
    queryConversationHistory: (params) => {
      if (!deps.queryConversationHistoryRef.current) throw new Error("queryConversationHistory is not initialized");
      return deps.queryConversationHistoryRef.current(params);
    },
    createEvolutionCandidate: (params) => {
      if (!deps.createEvolutionCandidateRef.current) throw new Error("createEvolutionCandidate is not initialized");
      return deps.createEvolutionCandidateRef.current(params);
    },
    searchFeatureChain: (params) => {
      if (!deps.searchFeatureChainRef.current) throw new Error("searchFeatureChain is not initialized");
      return deps.searchFeatureChainRef.current(params);
    },
  }));

  adapter.registerServer(createKnowledgeServer(deps.knowledge));
  adapter.registerServer(createRednoteResearchServer());

  return { adapter };
}
