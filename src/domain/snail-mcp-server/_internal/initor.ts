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
  /** database（用于复杂查询：conversation context、history、feature chain） */
  db: SQLiteDatabase;
  /** evolution adapter（延迟注入：init 时未就绪，首次 agent 调用前由 main.ts 赋值） */
  evolutionRef: { current?: EvolutionPort };
  /** 创建演进候选函数（延迟注入：依赖 evolution + collaboration） */
  createEvolutionCandidateRef: { current?: IssueServerDeps["createEvolutionCandidate"] };
  /** 查询 conversation 上下文函数（立即初始化：只需 db） */
  queryConversationContextRef: { current?: IssueServerDeps["queryConversationContext"] };
  /** 查询 conversation 历史函数（立即初始化：只需 db） */
  queryConversationHistoryRef: { current?: IssueServerDeps["queryConversationHistory"] };
  /** 搜索 feature chain 函数（延迟注入：首次调用时初始化） */
  searchFeatureChainRef: { current?: IssueServerDeps["searchFeatureChain"] };
}

export function init(deps: SnailMCPServerDeps) {
  const adapter = new SnailMCPServerAdapter();

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
      if (!deps.queryConversationContextRef.current) throw new Error("queryConversationContext not initialized");
      return deps.queryConversationContextRef.current(conversationId);
    },
    queryConversationHistory: (params) => {
      if (!deps.queryConversationHistoryRef.current) throw new Error("queryConversationHistory not initialized");
      return deps.queryConversationHistoryRef.current(params);
    },
    createEvolutionCandidate: (params) => {
      if (!deps.createEvolutionCandidateRef.current) throw new Error("createEvolutionCandidate not initialized");
      return deps.createEvolutionCandidateRef.current(params);
    },
    searchFeatureChain: (params) => {
      if (!deps.searchFeatureChainRef.current) throw new Error("searchFeatureChain not initialized");
      return deps.searchFeatureChainRef.current(params);
    },
  }));

  adapter.registerServer(createKnowledgeServer(deps.knowledge));
  adapter.registerServer(createRednoteResearchServer());

  return { adapter };
}
