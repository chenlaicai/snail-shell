/**
 * Playwright 搜索引擎。
 *
 * 导航到小红书搜索页 → 等待 __INITIAL_STATE__ → 提取 feed 列表。
 */

import type { BrowserContext } from "playwright-core";
import { newPage } from "../browser";
import type { Feed, SearchResultItem } from "../types";

/**
 * 解析小红书返回的数字字符串（支持 "万"/"亿"）。
 */
export function parseCount(raw: string | undefined): number {
  if (!raw) return 0;
  const s = raw.trim();
  if (s.endsWith("亿")) return Math.round(parseFloat(s) * 100_000_000);
  if (s.endsWith("万")) return Math.round(parseFloat(s) * 10_000);
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 将小红书 Feed 转换为统一的 SearchResultItem。
 * 用解构 + 空对象合并降低圈复杂度。
 */
function feedToResult({ id, xsecToken, noteCard: nc }: Feed): SearchResultItem {
  const user = nc.user ?? ({} as Record<string, string>);
  const info = nc.interactInfo ?? ({} as Record<string, string>);
  const cover = nc.cover ?? ({} as Record<string, string>);
  return {
    id,
    xsecToken,
    title: nc.displayTitle ?? "",
    author: user.nickname ?? "",
    authorId: user.userId ?? "",
    likes: parseCount(info.likedCount),
    comments: parseCount(info.commentCount),
    favorites: parseCount(info.collectedCount),
    coverUrl: cover.urlDefault ?? cover.url,
    score: 0,
    relevance: 0,
    recency: 0,
    engagement: 0,
  };
}

/**
 * 搜索单个关键词。
 *
 * @param context Playwright 浏览器上下文
 * @param keyword 搜索关键词
 * @returns 搜索结果列表
 */
/**
 * 抓取单页搜索结果。
 * 成功返回 Feed 数组，auth 失败抛异常，其他错误返回空数组。
 */
async function fetchSearchPage(context: BrowserContext, keyword: string, pageNum: number): Promise<Feed[]> {
  const page = await newPage(context);
  try {
    const params = new URLSearchParams({ keyword, source: "web_explore_feed", page_num: String(pageNum) });
    await page.goto(`https://www.xiaohongshu.com/search_result?${params.toString()}`, { waitUntil: "domcontentloaded" });
    const currentUrl = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("passport")) throw new Error("auth_required");
    await page.waitForFunction(() => (globalThis as any).__INITIAL_STATE__ !== undefined, { timeout: 15_000 });
    return page.evaluate(() => {
      const state = (globalThis as any).__INITIAL_STATE__;
      const raw = state?.search?.feeds?.value ?? state?.search?.feeds?._value ?? [];
      if (!Array.isArray(raw)) return [];
      return raw.filter((f: any) => f && typeof f.id === "string" && f.noteCard) as Feed[];
    });
  } catch (err) {
    if (err instanceof Error && err.message === "auth_required") throw err;
    logSearchError(keyword, err, pageNum);
    return [];
  } finally {
    await page.close();
  }
}

function logSearchError(keyword: string, err: unknown, pageNum?: number): void {
  const tag = pageNum ? `page=${pageNum}` : "";
  if (err instanceof Error && err.name === "TimeoutError") {
    console.warn(`[rednote-research] 搜索超时 (keyword=${keyword}, ${tag}):`, err.message);
  } else if (err instanceof Error && err.message.includes("net::ERR_")) {
    console.warn(`[rednote-research] 网络错误 (keyword=${keyword}):`, err.message);
  } else if (err instanceof Error && (err.message.includes("429") || err.message.includes("captcha"))) {
    console.warn(`[rednote-research] 触发风控 (keyword=${keyword}):`, err.message);
  } else {
    console.error(`[rednote-research] 搜索异常 (keyword=${keyword}):`, err);
  }
}

export async function searchOne(context: BrowserContext, keyword: string, maxPages = 1): Promise<SearchResultItem[]> {
  const allResults: SearchResultItem[] = [];
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const feeds = await fetchSearchPage(context, keyword, pageNum);
    if (feeds.length === 0) break;
    allResults.push(...feeds.map(feedToResult));
    if (pageNum < maxPages) await new Promise((r) => setTimeout(r, 800));
  }
  return allResults;
}

/**
 * 并发搜索多个关键词。
 *
 * @param context Playwright 浏览器上下文
 * @param keywords 关键词列表
 * @param concurrency 最大并发数（默认 3，浏览器资源有限不宜太高）
 * @returns 合并后的搜索结果（未去重、未评分）
 */
export async function searchMultiple(
  context: BrowserContext,
  keywords: string[],
  concurrency = 3,
  maxPages = 1,
): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  for (let i = 0; i < keywords.length; i += concurrency) {
    const batch = keywords.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((kw) => searchOne(context, kw, maxPages)),
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(...r.value);
      } else if (r.reason instanceof Error && r.reason.message === "auth_required") {
        throw r.reason;
      } else {
        console.warn("[rednote-research] 搜索关键词失败:", r.reason);
      }
    }
    // 批次失败率过高时警告（可能触发风控）
    const failCount = batchResults.filter((r) => r.status === "rejected").length;
    if (failCount > batch.length / 2) {
      console.warn(`[rednote-research] 批次失败率过高 (${failCount}/${batch.length})，可能触发风控`);
    }
  }
  return results;
}
