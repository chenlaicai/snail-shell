import type { FeatureDoc, FeatureSearchResult, FeatureChain } from "@domain/feature-chain/model";
import type { FeatureChainPort } from "@domain/feature-chain/port";
import type { FeatureChainRepository } from "@domain/feature-chain/_internal/repository";
import type { FeatureDocSearchIndex } from "@domain/feature-chain/_internal/search-index";

/**
 * Feature Chain 适配器实现。
 * 实现业务逻辑，调用 repository 完成持久化。
 */
export class FeatureChainAdapter implements FeatureChainPort {
  constructor(
    private repo: FeatureChainRepository,
    private searchIndex: FeatureDocSearchIndex,
  ) {}

  search(query: string, limit?: number): FeatureSearchResult[] {
    return this.searchIndex.search(query, limit);
  }

  get(id: string): FeatureDoc | undefined {
    return this.repo.get(id);
  }

  chain(id: string, direction: "backward" | "forward" | "both"): FeatureChain {
    return this.repo.chain(id, direction);
  }

  rebuild(): void {
    this.repo.rebuild();
    this.searchIndex.rebuild(this.repo.listAll());
  }
}
