import type { SearchOptions, UnifiedSearchResult, ChannelResult, ContentType } from "@domain/memory-search/model";

/**
 * 搜索通道接口。各域实现此接口以接入统一搜索。
 *
 * 协调器通过此接口查询各域，某域失败时跳过（B13 部分降级）。
 */
export interface SearchChannel {
  /** 域标识 */
  readonly domain: string;
  /** 内容类型 */
  readonly content_type: ContentType;

  /** 搜索，返回原始 bm25 分数的结果列表 */
  search(query: string, options: SearchOptions): ChannelResult[];

  /** 重建索引 */
  rebuild(): void;

  /** 校验索引完整性（返回 false 表示需要重建） */
  validate(): boolean;
}

/**
 * 搜索协调器端口。
 *
 * 顺序查询各域 Channel，融合排序后返回 top N。
 */
export interface SearchCoordinatorPort {
  /** 跨域搜索 */
  search(query: string, options: SearchOptions): UnifiedSearchResult[];

  /** 注册搜索通道 */
  registerChannel(channel: SearchChannel): void;
}
