/**
 * Evolution Service — 演进治理的跨模块编排。
 *
 * 编排模块：evolution, issue
 */

import type { EvolutionItem, KnowledgeEntry } from '@/evolution/types.js';

/** 创建演进项的输入参数 */
export interface CreateEvolutionItemInput {
  workspace_id: string;
  issue_id?: string;
  type: EvolutionItem['type'];
  title: string;
  content: string;
  tags?: string[];
}

/** 发布知识条目的输入参数 */
export interface PublishKnowledgeInput {
  workspace_id?: string;
  scope: KnowledgeEntry['scope'];
  source_evolution_id: string;
  title: string;
  content: string;
  tags?: string[];
}

/**
 * Evolution Service 接口。
 *
 * 跨模块编排：创建演进项 → 审核 → 发布为知识条目
 */
export interface EvolutionService {
  /** 创建演进项 */
  createItem(input: CreateEvolutionItemInput): Promise<EvolutionItem>;

  /** 更新演进项状态 */
  updateItemStatus(itemId: string, status: EvolutionItem['status']): Promise<EvolutionItem>;

  /** 从演进项发布知识条目 */
  publishKnowledge(input: PublishKnowledgeInput): Promise<KnowledgeEntry>;

  /** 搜索知识条目 */
  searchKnowledge(query: string, workspaceId?: string): Promise<KnowledgeEntry[]>;
}
