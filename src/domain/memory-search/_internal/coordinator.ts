import type { SearchOptions, UnifiedSearchResult, ContentType } from "@domain/memory-search/model";
import type { SearchChannel, SearchCoordinatorPort } from "@domain/memory-search/port";
import { fuseAndRank } from "@domain/memory-search/_internal/fusion-ranker";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "memory-search" });

/** trigram 查询最小字符数（<3 字符回退 LIKE） */
const TRIGRAM_MIN_CHARS = 3;

export class SearchCoordinator implements SearchCoordinatorPort {
  private channels = new Map<ContentType, SearchChannel>();

  registerChannel(channel: SearchChannel): void {
    this.channels.set(channel.content_type, channel);
  }

  search(query: string, options: SearchOptions): UnifiedSearchResult[] {
    const topN = options.top_n ?? 20;
    const activeChannels = this.getActiveChannels(options.content_types);

    if (activeChannels.length === 0) return [];

    // 顺序查询各域（SQLite 同步执行），某域失败时跳过（B13 部分降级）
    const allResults: ReturnType<SearchChannel["search"]> = [];
    for (const channel of activeChannels) {
      try {
        const results = channel.search(query, options);
        allResults.push(...results);
      } catch (err) {
        log.warn({ err, domain: channel.domain }, "Search channel failed, skipping");
      }
    }

    if (allResults.length === 0) return [];

    return fuseAndRank(allResults, topN);
  }

  private getActiveChannels(contentTypes?: ContentType[]): SearchChannel[] {
    if (!contentTypes || contentTypes.length === 0) {
      return Array.from(this.channels.values());
    }
    return contentTypes
      .map((ct) => this.channels.get(ct))
      .filter((c): c is SearchChannel => !!c);
  }
}

/**
 * 构建 FTS5 MATCH 查询表达式。
 *
 * trigram 分词器要求查询 ≥3 Unicode 字符才能使用 MATCH。
 * <3 字符时返回 null，调用方回退到原始表 LIKE。
 */
export function buildFtsMatchQuery(query: string): string | null {
  const unicodeChars = [...query].filter((c) => c.trim().length > 0);
  if (unicodeChars.length < TRIGRAM_MIN_CHARS) return null;

  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;

  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}
