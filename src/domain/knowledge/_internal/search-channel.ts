import type { SearchChannel } from "@domain/memory-search/port";
import type { ChannelResult, SearchOptions } from "@domain/memory-search/model";
import type { KnowledgeSearchIndex } from "@domain/knowledge/_internal/search-index";

/**
 * Knowledge 域 SearchChannel 实现。
 * 包装 KnowledgeSearchIndex，适配统一搜索协调器接口。
 */
export class KnowledgeSearchChannel implements SearchChannel {
  readonly domain = "knowledge";
  readonly content_type = "knowledge" as const;

  constructor(private index: KnowledgeSearchIndex) {}

  search(query: string, options: SearchOptions): ChannelResult[] {
    return this.index.searchChannel(query, options);
  }

  rebuild(): void {
    // rebuild 由 knowledge initor 调用 index.rebuild(fileEntries)
    // 此处为 no-op，knowledge 域有自己的重建逻辑
  }

  validate(): boolean {
    // validate 由 knowledge initor 调用 index.validate(fileEntries)
    // 此处返回 true，knowledge 域有自己的校验逻辑
    return true;
  }
}
