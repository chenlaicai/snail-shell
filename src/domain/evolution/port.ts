import type {
  EvolutionItem,
  CreateEvolutionItemInput,
  UpdateEvolutionItemInput,
  EvolutionItemListFilters,
} from "./model";

/** Evolution 端口定义 */
export interface EvolutionPort {
  /** 按 ID 查找 */
  findById(id: string): EvolutionItem | undefined;

  /** 列出 */
  list(filters?: EvolutionItemListFilters): EvolutionItem[];

  /** 全文搜索 */
  search(query: string, filters?: EvolutionItemListFilters): EvolutionItem[];

  /** 创建 */
  create(input: CreateEvolutionItemInput): EvolutionItem;

  /** 更新 */
  update(id: string, input: UpdateEvolutionItemInput): EvolutionItem;
}
