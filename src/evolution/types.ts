/** 演进项类型 */
export type EvolutionItemType = 'lesson' | 'decision' | 'bug' | 'idea';

/** 演进项状态 */
export type EvolutionItemStatus = 'draft' | 'review' | 'published' | 'archived';

/** 演进项（经验教训、设计决策、bug 记录、改进建议） */
export interface EvolutionItem {
  /** 演进项 ID */
  id: string;
  /** 所属工作区 ID */
  workspace_id: string;
  /** 关联 Issue ID（可选） */
  issue_id?: string;
  /** 演进项类型 */
  type: EvolutionItemType;
  /** 演进项状态 */
  status: EvolutionItemStatus;
  /** 标题 */
  title: string;
  /** 内容 */
  content: string;
  /** 标签列表 */
  tags: string[];
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
}

/** 知识条目作用域 */
export type KnowledgeScope = 'global' | 'workspace';

/** 知识条目（从演进项中提炼的可复用知识） */
export interface KnowledgeEntry {
  /** 知识条目 ID */
  id: string;
  /** 所属工作区 ID（global 作用域时为 undefined） */
  workspace_id?: string;
  /** 作用域 */
  scope: KnowledgeScope;
  /** 标题 */
  title: string;
  /** 内容 */
  content: string;
  /** 来源演进项 ID */
  source_evolution_id?: string;
  /** 标签列表 */
  tags: string[];
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
}
