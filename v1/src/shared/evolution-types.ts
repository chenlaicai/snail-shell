// Evolution item types.
// 演进工作区：系统自提取的待治理条目，通过 Issue 进入工作区管理流程。

import type { Conversation } from "./domain-types";

export interface EvolutionItem {
  id: string;
  workspace_id: string;
  issue_id: string | null;
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
  workspaceId: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: string | null;
}

export interface UpdateEvolutionItemInput {
  issueId?: string | null;
  title?: string;
  content?: string;
  tags?: string[];
  metadata?: string | null;
}

export interface EvolutionItemListFilters {
  workspaceId?: string;
  issueId?: string | null;
  tags?: string[];
  query?: string;
  limit?: number;
  offset?: number;
}

export interface EvolutionItemSearchResult {
  id: string;
  workspace_id: string;
  issue_id: string | null;
  title: string;
  content: string;
  tags: string[];
  snippet: string;
  conversation: Conversation | null;
  updated_at: string;
}
