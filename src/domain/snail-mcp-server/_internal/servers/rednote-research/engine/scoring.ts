/**
 * 三维评分引擎。
 *
 * 相关性 40% + 时效性 25% + 互动量 35%
 * 复用 xhs-research 的算法。
 */

import type { SearchResultItem, DetailResult } from "@domain/snail-mcp-server/_internal/servers/rednote-research/types";

// ═══════════════════════════════════════════════════════════
// 字符级 bigram 生成
// ═══════════════════════════════════════════════════════════

/** 停用字：bigram 中包含这些单字时被过滤 */
const STOP_CHARS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
]);

export function toBigrams(text: string): Set<string> {
  const chars = [...text];
  const bigrams = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) {
    const bg = chars[i] + chars[i + 1];
    // 过滤包含停用字的 bigram
    if (!STOP_CHARS.has(chars[i]) && !STOP_CHARS.has(chars[i + 1])) {
      bigrams.add(bg);
    }
  }
  return bigrams;
}

// ═══════════════════════════════════════════════════════════
// 相关性评分 (40%)
//
// 注意：搜索结果 noteCard 不含 desc（仅详情页有），评分仅基于标题。
// ═══════════════════════════════════════════════════════════

function computeRelevance(query: string, title: string): number {
  const queryBigrams = toBigrams(query);
  const docBigrams = toBigrams(title);

  if (queryBigrams.size === 0) return 0;

  // coverage: 查询 bigrams 在文档中出现的比例
  let matched = 0;
  for (const bg of queryBigrams) {
    if (docBigrams.has(bg)) matched++;
  }
  const coverage = matched / queryBigrams.size;

  // precision: 文档 bigrams 中有多少是查询相关的
  const precision = docBigrams.size > 0 ? matched / docBigrams.size : 0;

  // title bonus: 标题中是否有 ≥50% 的查询 bigrams（现在 doc 即 title，bonus 等价于 coverage≥0.5）
  const titleBonus = coverage >= 0.5 ? 0.15 : 0;

  const raw = 0.6 * Math.pow(coverage, 1.35) + 0.25 * precision + titleBonus;
  return Math.min(100, raw * 100);
}

// ═══════════════════════════════════════════════════════════
// 时效性评分 (25%)
// ═══════════════════════════════════════════════════════════

function computeRecency(publishTime: number | undefined, windowDays: number): number {
  if (!publishTime) return 30; // 未知时间给中等分
  const ageDays = (Date.now() - publishTime) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return 30; // 未来时间视为异常数据
  const score = 100 * (1 - ageDays / windowDays);
  return Math.max(0, score);
}

// ═══════════════════════════════════════════════════════════
// 互动量评分 (35%)
// ═══════════════════════════════════════════════════════════

function engagementRaw(item: SearchResultItem): number {
  return 0.4 * Math.log1p(item.favorites) + 0.3 * Math.log1p(item.likes) + 0.3 * Math.log1p(item.comments);
}

/**
 * 对结果集进行三维评分。
 *
 * @param items 搜索结果（需包含 likes/comments/favorites/publishTime）
 * @param query 原始查询词
 * @param windowDays 时效窗口（默认 365 天）
 * @returns 评分后的结果（已排序，score 范围 0-100）
 */
export function scoreResults(
  items: SearchResultItem[],
  query: string,
  windowDays = 365,
): SearchResultItem[] {
  if (items.length === 0) return [];

  // 计算原始互动分（用于 min-max 归一化）
  const rawEngagements = items.map(engagementRaw);
  const minEng = Math.min(...rawEngagements);
  const maxEng = Math.max(...rawEngagements);
  const engRange = maxEng - minEng || 1;

  return items
    .map((item, i) => {
      const relevance = computeRelevance(query, item.title);
      const recency = computeRecency(item.publishTime, windowDays);
      const engagement = ((rawEngagements[i] - minEng) / engRange) * 100;

      const score = 0.4 * relevance + 0.25 * recency + 0.35 * engagement;
      return { ...item, score, relevance, recency, engagement };
    })
    .sort((a, b) => b.score - a.score || engagementRaw(b) - engagementRaw(a));
}

/**
 * 用详情页的 desc 文本重新计算 Top N 的相关性评分。
 * 搜索结果 noteCard 不含 desc，详情抓取后可获得更准确的相关性。
 */
export function rescoreWithDesc(
  items: SearchResultItem[],
  details: Map<string, DetailResult>,
  query: string,
  windowDays: number,
): SearchResultItem[] {
  return items
    .map((item) => {
      const detail = details.get(item.id);
      if (!detail?.content) return item;
      const combinedText = item.title + " " + detail.content;
      const relevance = computeRelevance(query, combinedText);
      const recency = computeRecency(item.publishTime, windowDays);
      const score = 0.4 * relevance + 0.25 * recency + 0.35 * item.engagement;
      return { ...item, score, relevance };
    })
    .sort((a, b) => b.score - a.score || engagementRaw(b) - engagementRaw(a));
}
