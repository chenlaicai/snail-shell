/** Issue.context 中存储演进项 ID 的 key（同时也是环境变量名） */
export const EVOLUTION_ITEM_ID_KEY = "SNAIL_CTX_EVOLUTION_ITEM_ID";

/** 演进项状态 */
export enum EvolutionStatus {
  /** 候选：刚提取，待审批 */
  Candidate = "candidate",
  /** 进行中：已创建 issue，正在处理 */
  InProgress = "in_progress",
  /** 已完成：结果已回写 */
  Completed = "completed",
}

/** 演进项实体 */
export interface EvolutionItem {
  id: string;
  workspace_id: string;
  status: EvolutionStatus;
  /** 关联的 issue ID（InProgress/Completed 时有值） */
  issue_id: string | null;
  title: string;
  content: string;
  tags: string[];
  /** 处理结果摘要（Completed 时有值） */
  result: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

/** 创建演进项输入 */
export interface CreateEvolutionItemInput {
  workspace_id: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: unknown;
}

/** 演进项列表过滤条件 */
export interface EvolutionItemListFilters {
  workspace_id?: string;
  status?: EvolutionStatus;
  tags?: string[];
  limit?: number;
  offset?: number;
}
