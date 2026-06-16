import type { FeatureDoc, FeatureSearchResult, FeatureChain } from "@domain/feature-chain/model";

/** Feature Chain 端口定义 */
export interface FeatureChainPort {
  /** 全文搜索 */
  search(query: string, limit?: number): FeatureSearchResult[];

  /** 获取单个 Feature 文档 */
  get(id: string): FeatureDoc | undefined;

  /** 获取引用链 */
  chain(id: string, direction: "backward" | "forward" | "both"): FeatureChain;

  /** 重建索引（启动时调用） */
  rebuild(): void;
}
