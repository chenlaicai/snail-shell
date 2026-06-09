/**
 * Rednote Research MCP 工具定义和 handler。
 *
 * 暴露 3 个 tools：
 * - research_notes: 一站式调研（关键词扩展 → 多轮搜索 → 去重 → 评分 → 详情抓取）
 * - login: 打开登录页，等待扫码
 * - check_login: 检查登录状态
 */

import { launchContext, checkLoginStatus, waitForLogin } from "./browser";
import { expandKeywords } from "./engine/keywords";
import { searchMultiple } from "./engine/search";
import { deduplicate } from "./engine/dedup";
import { scoreResults, rescoreWithDesc } from "./engine/scoring";
import { fetchDetails } from "./engine/detail";
import type { ResearchResult, SearchResultItem, DetailResult } from "./types";

// ═══════════════════════════════════════════════════════════
// MCP Tool 定义
// ═══════════════════════════════════════════════════════════

export const REDNOTE_TOOLS = [
  {
    name: "research_notes",
    description:
      "小红书一站式调研工具。输入调研主题，自动扩展关键词、多轮搜索、去重、评分、抓取详情，返回结构化结果。" +
      "如果返回 auth_required 错误，需先调用 login 登录。" +
      "如果返回 no_results 错误，建议用户尝试其他关键词。",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "调研主题，如 '咖啡机推荐'" },
        options: {
          type: "object",
          description: "可选参数",
          properties: {
            depth: { type: "string", enum: ["quick", "deep"], description: "调研深度，默认 deep" },
            days: { type: "number", description: "搜索时间范围（天数），0 表示不限（当前版本暂未实现时间筛选）" },
            top_n: { type: "number", description: "详情抓取数量，默认 20（quick 模式默认 8）" },
          },
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "login",
    description: "打开小红书登录页面，显示二维码等待扫码。超时 120 秒。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_login",
    description: "检查当前小红书登录状态。",
    inputSchema: { type: "object", properties: {} },
  },
];

// ═══════════════════════════════════════════════════════════
// Handler
// ═══════════════════════════════════════════════════════════

type McpResult = { content: Array<{ type: "text"; text: string }> };

function mcpSuccess(data: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function mcpError(message: string): McpResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
}

interface ResearchParams {
  topic: string;
  depth: "quick" | "deep";
  days: number;
  topN: number;
}

function parseResearchParams(params: Record<string, unknown>): ResearchParams | string {
  const topic = typeof params.topic === "string" ? params.topic.trim() : "";
  if (!topic) return "validation_error: topic is required";
  const opts = (params.options ?? {}) as Record<string, unknown>;
  const depth = opts.depth === "quick" ? "quick" : "deep";
  const days = typeof opts.days === "number" && opts.days > 0 ? opts.days : 0;
  const defaultTopN = depth === "quick" ? 8 : 20;
  const rawTopN = typeof opts.top_n === "number" ? opts.top_n : defaultTopN;
  const topN = Math.max(1, Math.min(rawTopN, 50));
  return { topic, depth, days, topN };
}

interface BuildResultOpts {
  topic: string;
  keywords: string[];
  scored: SearchResultItem[];
  totalSearched: number;
  totalAfterDedup: number;
  topN: number;
}

function attachDetails(items: SearchResultItem[], details: Map<string, DetailResult>) {
  return items.map((item) => ({
    ...item,
    url: `https://www.xiaohongshu.com/explore/${item.id}`,
    ...(details.has(item.id) ? { detail: details.get(item.id) } : {}),
  }));
}

function buildResearchResult(opts: BuildResultOpts): ResearchResult {
  const { topic, keywords, scored, totalSearched, totalAfterDedup, topN } = opts;
  const results = scored.slice(0, topN).map((item) => ({ ...item, url: `https://www.xiaohongshu.com/explore/${item.id}` }));
  const authorCounts = new Map<string, number>();
  for (const r of results) authorCounts.set(r.author, (authorCounts.get(r.author) ?? 0) + 1);
  const topAuthor = [...authorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    topic, keywords_used: keywords, total_searched: totalSearched, total_after_dedup: totalAfterDedup, results,
    stats: { top_author: topAuthor, max_engagement: results[0] ? Math.round(0.4 * Math.log1p(results[0].favorites) + 0.3 * Math.log1p(results[0].likes) + 0.3 * Math.log1p(results[0].comments)) : 0, search_rounds: keywords.length },
  };
}

async function executeSearchPipeline(
  context: Awaited<ReturnType<typeof launchContext>>,
  keywords: string[],
  maxPages: number,
): Promise<SearchResultItem[] | string> {
  try {
    return await searchMultiple(context, keywords, 3, maxPages);
  } catch (err) {
    if (err instanceof Error && err.message === "auth_required") {
      return "auth_required: 登录已过期，请调用 login 工具扫码登录";
    }
    throw err;
  }
}

/**
 * 执行 research_notes 完整调研流程。
 */
async function handleResearchNotes(params: Record<string, unknown>): Promise<McpResult> {
  const parsed = parseResearchParams(params);
  if (typeof parsed === "string") return mcpError(parsed);
  const { topic, depth, days, topN } = parsed;
  const keywords = expandKeywords(topic);

  let context;
  try {
    context = await launchContext(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return mcpError(msg.includes("未找到 Chrome") ? msg : `启动浏览器失败: ${msg}`);
  }

  try {
    const searchResult = await executeSearchPipeline(context, keywords, depth === "deep" ? 3 : 1);
    if (typeof searchResult === "string") return mcpError(searchResult);
    if (searchResult.length === 0) return mcpError("no_results: 未找到相关笔记，请尝试其他关键词");

    const windowDays = days > 0 ? days : 365;
    const scored = scoreResults(deduplicate(searchResult), topic, windowDays);
    const topItems = scored.slice(0, topN);
    const details = await fetchDetails(context, topItems, depth === "quick" ? 5 : 8, 500);
    const rescored = rescoreWithDesc(topItems, details, topic, windowDays);
    return mcpSuccess(buildResearchResult({
      topic, keywords, scored: attachDetails(rescored, details), totalSearched: searchResult.length, totalAfterDedup: scored.length, topN,
    }));
  } finally {
    await context.close();
  }
}

/**
 * 处理 login 请求。
 */
async function handleLogin(): Promise<McpResult> {
  try {
    const success = await waitForLogin(120_000);
    if (success) {
      return mcpSuccess({ status: "success", message: "登录成功" });
    }
    return mcpSuccess({ status: "timeout", message: "登录超时，请重试" });
  } catch (err) {
    return mcpError(`登录失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 处理 check_login 请求。
 */
async function handleCheckLogin(): Promise<McpResult> {
  try {
    const isLoggedIn = await checkLoginStatus();
    return mcpSuccess({
      logged_in: isLoggedIn,
      message: isLoggedIn ? "已登录" : "未登录或登录已过期",
    });
  } catch (err) {
    return mcpError(`检查登录状态失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * MCP tools/call 路由。
 */
export async function handleRednoteToolCall(params: unknown): Promise<McpResult> {
  const p = params as Record<string, unknown> | null | undefined;
  if (!p || typeof p.name !== "string") return mcpError("Invalid params");

  const name = p.name;
  const args = (p.arguments ?? {}) as Record<string, unknown>;

  switch (name) {
    case "research_notes":
      return handleResearchNotes(args);
    case "login":
      return handleLogin();
    case "check_login":
      return handleCheckLogin();
    default:
      return mcpError(`Unknown tool: ${name}`);
  }
}
