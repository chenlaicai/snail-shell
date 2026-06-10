/** Evolution Item 实体 */
export interface EvolutionItem {
  id: string;
  workspace_id: string;
  issue_id: string | null;
  title: string;
  content: string;
  tags: string[];
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

/** 创建 Evolution Item 输入 */
export interface CreateEvolutionItemInput {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: unknown;
}

/** 更新 Evolution Item 输入 */
export interface UpdateEvolutionItemInput {
  issue_id?: string;
  title?: string;
  content?: string;
  tags?: string[];
  metadata?: unknown;
}

/** Evolution Item 列表过滤条件 */
export interface EvolutionItemListFilters {
  workspace_id?: string;
  issue_id?: string;
  tags?: string[];
  query?: string;
  limit?: number;
  offset?: number;
}
