/**
 * Rednote Research 类型定义。
 *
 * 与小红书页面 __INITIAL_STATE__ 中的数据结构对齐。
 */

// ═══════════════════════════════════════════════════════════
// 小红书数据结构
// ═══════════════════════════════════════════════════════════

/** 用户信息 */
export interface XhsUser {
  userId: string;
  nickname: string;
  avatar: string;
}

/** 互动数据 */
export interface InteractInfo {
  likedCount: string;
  commentCount: string;
  collectedCount: string;
  shareCount?: string;
}

/** 笔记卡片（搜索结果中的摘要） */
export interface NoteCard {
  displayTitle: string;
  type: string;
  user: XhsUser;
  interactInfo: InteractInfo;
  cover?: { url: string; urlDefault?: string };
  video?: { url: string };
}

/** 搜索结果中的 Feed 条目 */
export interface Feed {
  id: string;
  xsecToken: string;
  modelType: string;
  noteCard: NoteCard;
}

/** 笔记详情（从详情页获取） */
export interface NoteDetail {
  desc: string;
  user: XhsUser;
  interactInfo: InteractInfo;
}

/** 评论 */
export interface Comment {
  id: string;
  content: string;
  userInfo: { nickname: string };
  likeCount: string;
  subComments?: Comment[];
}

// ═══════════════════════════════════════════════════════════
// 引擎内部结构
// ═══════════════════════════════════════════════════════════

/** 搜索结果条目（引擎处理后的统一格式） */
export interface SearchResultItem {
  id: string;
  xsecToken: string;
  title: string;
  author: string;
  authorId: string;
  likes: number;
  comments: number;
  favorites: number;
  coverUrl?: string;
  publishTime?: number; // epoch ms
  score: number;
  relevance: number;
  recency: number;
  engagement: number;
}

/** 详情结果 */
export interface DetailResult {
  content: string;
  comments: Array<{
    author: string;
    content: string;
    likes: number;
    replies: Array<{ author: string; content: string; likes: number }>;
  }>;
}

/** 最终返回给 LLM 的结构 */
export interface ResearchResult {
  topic: string;
  keywords_used: string[];
  total_searched: number;
  total_after_dedup: number;
  results: Array<SearchResultItem & { detail?: DetailResult; url: string }>;
  stats: {
    top_author: string;
    max_engagement: number;
    search_rounds: number;
  };
}

/** 查询意图类型 */
export type QueryIntent = "推荐" | "测评" | "攻略" | "避雷" | "产品调研" | "竞品调研" | "需求调研" | "调研" | "通用";
