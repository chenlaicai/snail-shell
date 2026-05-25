// Knowledge library types.
// 知识库：已发布知识的统一存储。来源于 knowledge_item 治理审批后的下游目标。

import type { KnowledgeKind } from "./knowledge-types";

export type KnowledgeLibraryStatus = "active" | "superseded" | "deprecated";

export interface KnowledgeLibraryEntry {
  id: string;
  project_id: string | null;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  use_scenarios: string;
  non_use_scenarios: string;
  content: string;
  status: KnowledgeLibraryStatus;
  source_knowledge_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeLibrarySearchResult {
  id: string;
  project_id: string | null;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  use_scenarios: string;
  non_use_scenarios: string;
  content: string;
  snippet: string;
  status: KnowledgeLibraryStatus;
  source_knowledge_id: string | null;
  updated_at: string;
}

export interface CreateKnowledgeLibraryInput {
  id: string;
  projectId?: string | null;
  kind: KnowledgeKind;
  title: string;
  summary?: string;
  useScenarios?: string;
  nonUseScenarios?: string;
  content: string;
  status?: KnowledgeLibraryStatus;
  sourceKnowledgeId?: string | null;
}

export interface UpdateKnowledgeLibraryInput {
  title?: string;
  summary?: string;
  useScenarios?: string;
  nonUseScenarios?: string;
  content?: string;
  status?: KnowledgeLibraryStatus;
  kind?: KnowledgeKind;
  projectId?: string | null;
}

export interface KnowledgeLibraryListFilters {
  projectId?: string | null;
  kind?: KnowledgeKind;
  status?: KnowledgeLibraryStatus;
  query?: string;
  limit?: number;
  offset?: number;
}

/** L1 概览：按 kind 分组返回各分类条目数。 */
export interface KnowledgeLibraryKindSummary {
  kind: KnowledgeKind;
  count: number;
}
