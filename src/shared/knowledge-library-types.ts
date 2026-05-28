// Knowledge library types.
// 知识库：已发布知识的统一存储。来源于演进项治理后的下游产物。

export type KnowledgeLibraryScope = "global" | "project";
export type KnowledgeLibraryStatus = "active" | "superseded" | "deprecated";

export interface KnowledgeLibraryEntry {
  id: string;
  scope: KnowledgeLibraryScope;
  project_id: string | null;
  title: string;
  content: string;
  status: KnowledgeLibraryStatus;
  source_evolution_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeLibrarySearchResult {
  id: string;
  scope: KnowledgeLibraryScope;
  project_id: string | null;
  title: string;
  content: string;
  snippet: string;
  status: KnowledgeLibraryStatus;
  source_evolution_item_id: string | null;
  updated_at: string;
}

export interface CreateKnowledgeLibraryInput {
  id: string;
  scope: KnowledgeLibraryScope;
  projectId?: string | null;
  title: string;
  content: string;
  status?: KnowledgeLibraryStatus;
  sourceEvolutionItemId?: string | null;
}

export interface UpdateKnowledgeLibraryInput {
  scope?: KnowledgeLibraryScope;
  projectId?: string | null;
  title?: string;
  content?: string;
  status?: KnowledgeLibraryStatus;
}

export interface KnowledgeLibraryListFilters {
  scope?: KnowledgeLibraryScope;
  projectId?: string | null;
  status?: KnowledgeLibraryStatus;
  query?: string;
  limit?: number;
  offset?: number;
}
