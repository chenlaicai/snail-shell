/**
 * Evolution Service 接口
 *
 * 定义演进治理服务的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问 Evolution
 */

import type {
  EvolutionItem,
  CreateEvolutionItemInput,
  UpdateEvolutionItemInput,
  EvolutionItemListFilters,
} from "../types";

/**
 * Evolution Service 接口
 *
 * 定义演进治理服务的操作。
 */
export interface EvolutionService {
  /**
   * 创建 Evolution Item
   * @param input 创建输入
   * @returns Evolution Item
   */
  create(input: CreateEvolutionItemInput): Promise<EvolutionItem>;

  /**
   * 获取 Evolution Item
   * @param id Item ID
   * @returns Evolution Item，不存在返回 null
   */
  get(id: string): Promise<EvolutionItem | null>;

  /**
   * 获取 Evolution Item 列表
   * @param filters 过滤器
   * @returns Evolution Item 列表
   */
  list(filters?: EvolutionItemListFilters): Promise<EvolutionItem[]>;

  /**
   * 更新 Evolution Item
   * @param id Item ID
   * @param input 更新输入
   * @returns Evolution Item
   */
  update(id: string, input: UpdateEvolutionItemInput): Promise<EvolutionItem>;
}
