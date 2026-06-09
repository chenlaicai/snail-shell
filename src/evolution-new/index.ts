/**
 * Evolution 模块
 *
 * 提供演进治理的领域功能。
 *
 * 架构说明：
 * - types: 公开类型定义
 * - service: Service 接口定义
 * - internal: 私有实现（在 database 模块中）
 *
 * 依赖倒置：
 * - 本模块定义 Service 接口
 * - database 模块实现这些接口
 * - 本模块通过接口访问 Evolution
 */

// ═══ 公开类型 ═══
export type {
  EvolutionItem,
  EvolutionItemType,
  EvolutionItemStatus,
  CreateEvolutionItemInput,
  UpdateEvolutionItemInput,
  EvolutionItemListFilters,
} from "./types";

// ═══ Service 接口 ═══
export type { EvolutionService } from "./service";
