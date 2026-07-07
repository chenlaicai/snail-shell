import type { ChannelResult, UnifiedSearchResult, ContentType } from "@domain/memory-search/model";

/** 域权重（硬编码，见 Feature 文档决策记录） */
const DOMAIN_WEIGHTS: Record<ContentType, number> = {
  knowledge: 1.0,
  feature_doc: 1.0,
  evolution: 0.9,
  message: 0.8,
};

/**
 * 融合排序器。
 *
 * 步骤：
 * 1. 各域 bm25 分数 max 归一化到 [0, 1]
 * 2. 域权重加权
 * 3. 条件多样性重排（仅当域间最高分差异 <20% 时启用）
 * 4. 取 top N
 */
export function fuseAndRank(
  results: ChannelResult[],
  topN: number,
): UnifiedSearchResult[] {
  if (results.length === 0) return [];

  // ── Step 1: max 归一化 ──
  // 按 content_type 分组，各域内 max 归一化
  const byDomain = groupByDomain(results);
  const normalized = normalizeByDomain(byDomain);

  // ── Step 2: 域权重加权 ──
  const weighted = normalized.map((r) => ({
    ...r,
    score: r.raw_score * (DOMAIN_WEIGHTS[r.content_type] ?? 1.0),
  }));

  // ── Step 3: 条件多样性重排 ──
  const domainMaxScores = computeDomainMaxScores(weighted);
  const topScore = Math.max(...domainMaxScores.values());
  const minScore = Math.min(...domainMaxScores.values());
  const shouldDiversify = topScore > 0 && (topScore - minScore) / topScore < 0.2;

  let ranked: typeof weighted;
  if (shouldDiversify) {
    ranked = applyDiversityRerank(weighted, topN);
  } else {
    ranked = weighted.sort((a, b) => b.score - a.score);
  }

  // ── Step 4: 取 top N ──
  return ranked.slice(0, topN).map(toUnifiedResult);
}

// ── 内部函数 ──────────────────────────────────────────────────────────

function groupByDomain(results: ChannelResult[]): Map<ContentType, ChannelResult[]> {
  const map = new Map<ContentType, ChannelResult[]>();
  for (const r of results) {
    const list = map.get(r.content_type) ?? [];
    list.push(r);
    map.set(r.content_type, list);
  }
  return map;
}

/**
 * max 归一化：各域内 score / max_score。
 * 避免单结果时的除零：单结果时分数设为 1.0（它就是该域最佳）。
 */
function normalizeByDomain(byDomain: Map<ContentType, ChannelResult[]>): ChannelResult[] {
  const result: ChannelResult[] = [];
  for (const [, list] of byDomain) {
    const maxScore = Math.max(...list.map((r) => r.raw_score));
    for (const r of list) {
      result.push({
        ...r,
        raw_score: maxScore > 0 ? r.raw_score / maxScore : 0,
      });
    }
  }
  return result;
}

function computeDomainMaxScores(results: Array<ChannelResult & { score: number }>): Map<ContentType, number> {
  const map = new Map<ContentType, number>();
  for (const r of results) {
    const current = map.get(r.content_type) ?? 0;
    if (r.score > current) map.set(r.content_type, r.score);
  }
  return map;
}

/**
 * 多样性重排：每域最多返回 ⌈top_n / num_active_domains × 1.5⌉ 条。
 * 在配额内按分数排序，保证不排除高分结果。
 */
function applyDiversityRerank(
  results: Array<ChannelResult & { score: number }>,
  topN: number,
): Array<ChannelResult & { score: number }> {
  const activeDomains = new Set(results.map((r) => r.content_type)).size;
  const perDomainLimit = Math.ceil((topN / activeDomains) * 1.5);

  // 按分数降序排列
  const sorted = results.sort((a, b) => b.score - a.score);

  // 按域配额选取
  const domainCounts = new Map<ContentType, number>();
  const picked: typeof sorted = [];

  for (const r of sorted) {
    const count = domainCounts.get(r.content_type) ?? 0;
    if (count < perDomainLimit) {
      picked.push(r);
      domainCounts.set(r.content_type, count + 1);
    }
  }

  return picked;
}

function toUnifiedResult(r: ChannelResult & { score: number }): UnifiedSearchResult {
  return {
    content_type: r.content_type,
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    score: r.score,
    source: r.source,
    metadata: r.metadata,
  };
}
