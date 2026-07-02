import type {
  EvolutionItem,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
} from "@domain/evolution/model";
import type { CollaborationInput } from "@app/issue-collaboration/port";

/** 窄接口：仅注入 createIssue，避免 domain→app 反向依赖 */
export type CreateIssueFn = CollaborationInput["createIssue"];

/** Evolution 端口定义 */
export interface EvolutionPort {
  /** 按 ID 查找 */
  findById(id: string): EvolutionItem | undefined;

  /** 列出（按状态、标签过滤，分页） */
  list(filters?: EvolutionItemListFilters): EvolutionItem[];

  /** 全文搜索标题和内容 */
  search(query: string, filters?: EvolutionItemListFilters): EvolutionItem[];

  /** 创建候选演进项（初始状态：Candidate） */
  create(input: CreateEvolutionItemInput): EvolutionItem;

  /** 更新演进项（状态、结果、元数据等） */
  update(id: string, updates: UpdateEvolutionItemInput): EvolutionItem;

  /** 基于 item 创建 issue（Candidate → InProgress）。item 自身提供全部信息。 */
  createIssue(itemId: string): Promise<EvolutionItem>;
}

/** 更新演进项输入 */
export interface UpdateEvolutionItemInput {
  status?: string;
  result?: string;
  title?: string;
  content?: string;
  tags?: string[];
  metadata?: unknown;
}
