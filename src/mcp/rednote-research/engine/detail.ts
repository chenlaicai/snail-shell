/**
 * 笔记详情 + 评论抓取引擎。
 *
 * 导航到笔记详情页，提取正文和评论。
 */

import type { BrowserContext, Page } from "playwright-core";
import { newPage } from "../browser";
import type { SearchResultItem, DetailResult } from "../types";

/**
 * 截断文本到指定长度。
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * 从 __INITIAL_STATE__ 提取详情数据。
 * 分离为独立函数以降低 fetchDetail 圈复杂度和行数。
 */
async function extractDetailFromPage(
  page: Page,
  noteId: string,
): Promise<{ desc: string; comments: any[] }> {
  return page.evaluate((id) => {
    const state = (globalThis as any).__INITIAL_STATE__;
    const note = state?.note?.noteDetailMap?.[id]?.note;
    if (!note) return { desc: "", comments: [] };
    return {
      desc: note.desc || "",
      comments: (note.comments || []).map((c: any) => ({
        id: c.id || "",
        content: c.content || "",
        userInfo: { nickname: c.userInfo?.nickname || "" },
        likeCount: String(c.likeCount || 0),
        subComments: (c.subComments || []).map((sc: any) => ({
          id: sc.id || "",
          content: sc.content || "",
          userInfo: { nickname: sc.userInfo?.nickname || "" },
          likeCount: String(sc.likeCount || 0),
        })),
      })),
    };
  }, noteId);
}

/**
 * 将原始评论数据转换为 DetailResult 格式。
 */
function formatComments(rawComments: any[], maxComments: number): DetailResult["comments"] {
  return rawComments.slice(0, maxComments).map((c: any) => ({
    author: c.userInfo?.nickname || "",
    content: c.content || "",
    likes: parseInt(c.likeCount, 10) || 0,
    replies: (c.subComments || []).slice(0, 2).map((sc: any) => ({
      author: sc.userInfo?.nickname || "",
      content: sc.content || "",
      likes: parseInt(sc.likeCount, 10) || 0,
    })),
  }));
}

/**
 * 获取单条笔记的详情和评论。
 */
export async function fetchDetail(
  context: BrowserContext,
  item: SearchResultItem,
  maxComments = 8,
): Promise<DetailResult> {
  const page = await newPage(context);
  try {
    await page.goto(`https://www.xiaohongshu.com/explore/${item.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (globalThis as any).__INITIAL_STATE__ !== undefined,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(1000);

    const raw = await extractDetailFromPage(page, item.id);
    return { content: truncate(raw.desc, 800), comments: formatComments(raw.comments, maxComments) };
  } catch (err) {
    console.warn("[rednote-research] 获取笔记详情失败:", err);
    return { content: "", comments: [] };
  } finally {
    await page.close();
  }
}

/**
 * 批量获取详情（带间隔，避免触发风控）。
 *
 * @param context Playwright 浏览器上下文
 * @param items 待获取详情的搜索结果
 * @param maxComments 最大评论数
 * @param delayMs 每次请求间隔（毫秒）
 * @returns 详情结果 Map（key 为 feed id）
 */
export async function fetchDetails(
  context: BrowserContext,
  items: SearchResultItem[],
  maxComments = 8,
  delayMs = 500,
): Promise<Map<string, DetailResult>> {
  const results = new Map<string, DetailResult>();
  for (const item of items) {
    const detail = await fetchDetail(context, item, maxComments);
    results.set(item.id, detail);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}
