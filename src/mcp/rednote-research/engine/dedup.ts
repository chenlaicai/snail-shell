/**
 * 两层去重引擎。
 *
 * 1. feed_id 精确去重
 * 2. Jaccard 标题去重（trigram，阈值 0.60）
 */

import type { SearchResultItem } from "../types";

/**
 * 第一层：feed_id 精确去重。
 * 保留每个 id 的第一条（通常互动量更高）。
 */
export function dedupById(items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Map<string, SearchResultItem>();
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.set(item.id, item);
    }
  }
  return [...seen.values()];
}

/**
 * 计算字符串的字符 trigram 集合。
 */
function trigrams(s: string): Set<string> {
  const chars = [...s];
  const result = new Set<string>();
  for (let i = 0; i < chars.length - 2; i++) {
    result.add(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return result;
}

/**
 * Jaccard 相似度。
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * 互动量总分（用于保留更热门的那条）。
 */
function engagementScore(item: SearchResultItem): number {
  return item.likes + item.comments * 2 + item.favorites;
}

/**
 * 第二层：Jaccard 标题去重。
 * 相似度 ≥ 0.60 时，保留互动量更高的那条。
 */
export function dedupByTitle(items: SearchResultItem[], threshold = 0.6): SearchResultItem[] {
  // 按互动量降序排列，这样遇到重复时保留先出现的（即更热门的）
  const sorted = [...items].sort((a, b) => engagementScore(b) - engagementScore(a));
  const titleTrigrams = sorted.map((item) => trigrams(item.title));

  const removed = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      if (removed.has(j)) continue;
      if (jaccard(titleTrigrams[i], titleTrigrams[j]) >= threshold) {
        removed.add(j);
      }
    }
  }

  return sorted.filter((_, i) => !removed.has(i));
}

/**
 * 完整去重流程：先按 id，再按标题。
 */
export function deduplicate(items: SearchResultItem[]): SearchResultItem[] {
  return dedupByTitle(dedupById(items));
}
