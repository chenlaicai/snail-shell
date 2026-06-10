import type {
  KnowledgeEntry,
  KnowledgeSearchResult,
  CreateKnowledgeInput,
  KnowledgeListFilters,
  KnowledgeSummary,
} from "./model";

/** Knowledge 端口定义 */
export interface KnowledgePort {
  /** 获取知识库摘要 */
  summary(workspaceId?: string): KnowledgeSummary;

  /** 列出条目 */
  list(filters?: KnowledgeListFilters): KnowledgeEntry[];

  /** 按 ID 查找 */
  findById(id: string): KnowledgeEntry | undefined;

  /** 全文搜索 */
  search(query: string, filters?: KnowledgeListFilters): KnowledgeSearchResult[];

  /** 创建条目 */
  create(input: CreateKnowledgeInput): KnowledgeEntry;
}
