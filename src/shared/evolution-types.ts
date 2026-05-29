// Evolution item types.
// 演进项：系统自提取的待治理条目，通过 Feature 进入项目管理流程。

import type { Conversation } from "./domain-types";

export interface EvolutionItem {
  id: string;
  project_id: string;
  feature_id: string | null;
  title: string;
  content: string;
  tags: string[];
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvolutionItemWithConversation extends EvolutionItem {
  conversation: Conversation | null;
}

export interface CreateEvolutionItemInput {
  id: string;
  projectId: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: string | null;
}

export interface UpdateEvolutionItemInput {
  featureId?: string | null;
  title?: string;
  content?: string;
  tags?: string[];
  metadata?: string | null;
}

export interface EvolutionItemListFilters {
  projectId?: string;
  featureId?: string | null;
  tags?: string[];
  query?: string;
  limit?: number;
  offset?: number;
}

export interface EvolutionItemSearchResult {
  id: string;
  project_id: string;
  feature_id: string | null;
  title: string;
  content: string;
  tags: string[];
  snippet: string;
  conversation: Conversation | null;
  updated_at: string;
}
