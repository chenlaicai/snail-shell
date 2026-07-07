/** 内容类型标识 */
export type ContentType = "knowledge" | "message" | "feature_doc" | "evolution";

/** 搜索选项 */
export interface SearchOptions {
  /** 限定搜索域 */
  content_types?: ContentType[];
  /** 标签过滤（OR 语义：匹配至少一个标签） */
  tags?: string[];
  /** 范围过滤：platform / workspace */
  scope?: string;
  /** 工作区路径（scope=workspace 时） */
  workspace_path?: string;
  /** 时间范围 */
  time_range?: {
    after?: string;
    before?: string;
  };
  /** 返回结果数（默认 20） */
  top_n?: number;
}

/** 统一搜索结果 */
export interface UnifiedSearchResult {
  content_type: ContentType;
  id: string;
  title: string;
  /** 高亮摘要 */
  snippet: string;
  /** 归一化分数 0-1 */
  score: number;
  source: {
    /** 域标识 */
    domain: string;
    /** 文件路径（如适用） */
    file_path?: string;
    /** 消息所属 stage（如适用） */
    stage_id?: string;
    /** 外部链接（如适用） */
    url?: string;
  };
  metadata: {
    tags?: string[];
    scope?: string;
    created_at?: string;
    [key: string]: unknown;
  };
}

/** 单个 Channel 的原始搜索结果（融合前） */
export interface ChannelResult {
  content_type: ContentType;
  id: string;
  title: string;
  snippet: string;
  /** 原始 bm25 分数（未归一化） */
  raw_score: number;
  source: UnifiedSearchResult["source"];
  metadata: UnifiedSearchResult["metadata"];
}
