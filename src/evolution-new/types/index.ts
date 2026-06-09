/**
 * Evolution 模块公开类型
 *
 * 定义演进治理的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Service 接口访问 Evolution
 */

/**
 * Evolution Item 类型
 */
export type EvolutionItemType =
  | "user_preference"
  | "long_term_rule"
  | "design_decision"
  | "process_constraint"
  | "failure_lesson"
  | "terminology"
  | "reusable_pattern"
  | "issue_bug"
  | "todo_item"
  | "idea";

/**
 * Evolution Item 状态
 */
export type EvolutionItemStatus = "pending" | "approved" | "rejected" | "archived";

/**
 * Evolution Item 实体（新架构）
 */
export interface EvolutionItem {
  /** Item ID */
  id: string;
  /** 会话 ID */
  conversation_id: string;
  /** Item 类型 */
  type: EvolutionItemType;
  /** Item 内容 */
  content: string;
  /** Item 状态 */
  status: EvolutionItemStatus;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/**
 * 创建 Evolution Item 输入
 */
export interface CreateEvolutionItemInput {
  conversation_id: string;
  type: EvolutionItemType;
  content: string;
}

/**
 * 更新 Evolution Item 输入
 */
export interface UpdateEvolutionItemInput {
  content?: string;
  status?: EvolutionItemStatus;
}

/**
 * Evolution Item 列表过滤器
 */
export interface EvolutionItemListFilters {
  conversation_id?: string;
  type?: EvolutionItemType;
  status?: EvolutionItemStatus;
}

// ═══ 兼容旧架构的类型 ═══

/**
 * Evolution Item 实体（旧架构兼容）
 */
export interface LegacyEvolutionItem {
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

/**
 * Evolution Item 搜索结果
 */
export interface EvolutionItemSearchResult {
  id: string;
  workspace_id: string;
  issue_id: string | null;
  title: string;
  content: string;
  tags: string[];
  snippet: string;
  conversation: unknown | null;
  updated_at: string;
}
