/** 知识库作用域 */
export type KnowledgeScope = "global" | "workspace";

/** 知识库条目 */
export interface KnowledgeEntry {
  id: string;
  scope: KnowledgeScope;
  workspace_id: string | null;
  title: string;
  content: string;
  source_evolution_item_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 搜索结果 */
export interface KnowledgeSearchResult extends KnowledgeEntry {
  snippet: string;
}

/** 创建输入 */
export interface CreateKnowledgeInput {
  id: string;
  scope: KnowledgeScope;
  workspace_id?: string | null;
  title: string;
  content: string;
  source_evolution_item_id?: string | null;
}

/** 列表过滤条件 */
export interface KnowledgeListFilters {
  scope?: KnowledgeScope;
  workspace_id?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

/** 知识库摘要 */
export interface KnowledgeSummary {
  global_count: number;
  workspace_count: number;
}
