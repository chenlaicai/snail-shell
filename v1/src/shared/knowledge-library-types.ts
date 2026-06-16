// Knowledge library types.
// 知识库：已发布知识的统一存储。来源于演进工作区治理后的下游产物。

export type KnowledgeLibraryScope = "global" | "workspace";

export interface KnowledgeLibraryEntry {
  id: string;
  scope: KnowledgeLibraryScope;
  workspace_id: string | null;
  title: string;
  content: string;
  source_evolution_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeLibrarySearchResult {
  id: string;
  scope: KnowledgeLibraryScope;
  workspace_id: string | null;
  title: string;
  content: string;
  snippet: string;
  source_evolution_item_id: string | null;
  updated_at: string;
}

export interface CreateKnowledgeLibraryInput {
  id: string;
  scope: KnowledgeLibraryScope;
  workspaceId?: string | null;
  title: string;
  content: string;
  sourceEvolutionItemId?: string | null;
}

export interface UpdateKnowledgeLibraryInput {
  scope?: KnowledgeLibraryScope;
  workspaceId?: string | null;
  title?: string;
  content?: string;
}

export interface KnowledgeLibraryListFilters {
  scope?: KnowledgeLibraryScope;
  workspaceId?: string | null;
  query?: string;
  limit?: number;
  offset?: number;
}
