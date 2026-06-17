import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import { launchContext, checkLoginStatus, waitForLogin, cleanupStaleBrowserProfiles, type BrowserConfig } from "@domain/snail-mcp-server/_internal/servers/rednote-research/browser";
import { expandKeywords } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/keywords";
import { searchMultiple } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/search";
import { deduplicate } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/dedup";
import { scoreResults, rescoreWithDesc } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/scoring";
import { fetchDetails } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/detail";
import type { SearchResultItem, DetailResult, ResearchResult } from "@domain/snail-mcp-server/_internal/servers/rednote-research/types";

/** rednote-research MCP Server 配置 */
export interface RednoteResearchConfig {
  /** 浏览器配置 */
  browser?: BrowserConfig;
  /** login 超时时间（毫秒），默认 120000 */
  loginTimeoutMs?: number;
}

/** 自定义错误类型，用于区分业务错误 */
class RednoteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "RednoteError";
  }
}

interface ResearchParams {
  topic: string;
  depth: "quick" | "deep";
  days: number;
  topN: number;
}

function parseResearchParams(params: Record<string, unknown>): ResearchParams {
  const topic = typeof params.topic === "string" ? params.topic.trim() : "";
  if (!topic) throw new RednoteError("topic is required", "validation_error");
  const opts = (params.options ?? {}) as Record<string, unknown>;
  const depth = opts.depth === "quick" ? "quick" : "deep";
  const days = typeof opts.days === "number" && opts.days > 0 ? opts.days : 0;
  const defaultTopN = depth === "quick" ? 8 : 20;
  const rawTopN = typeof opts.top_n === "number" ? opts.top_n : defaultTopN;
  const topN = Math.max(1, Math.min(rawTopN, 50));
  return { topic, depth, days, topN };
}

function attachDetails(items: SearchResultItem[], details: Map<string, DetailResult>) {
  return items.map((item) => ({
    ...item,
    url: `https://www.xiaohongshu.com/explore/${item.id}`,
    ...(details.has(item.id) ? { detail: details.get(item.id) } : {}),
  }));
}

interface BuildResultOpts {
  topic: string;
  keywords: string[];
  scored: SearchResultItem[];
  totalSearched: number;
  totalAfterDedup: number;
  topN: number;
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
): Promise<SearchResultItem[]> {
  try {
    return await searchMultiple(context, keywords, 3, maxPages);
  } catch (err) {
    if (err instanceof Error && err.message === "auth_required") {
      throw new RednoteError("登录已过期，请调用 login 工具扫码登录", "auth_required");
    }
    throw err;
  }
}

async function handleResearchNotes(params: Record<string, unknown>, config?: RednoteResearchConfig): Promise<unknown> {
  const parsed = parseResearchParams(params);
  const { topic, depth, days, topN } = parsed;
  const keywords = expandKeywords(topic);

  let context;
  try {
    context = await launchContext(true, config?.browser);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RednoteError(
      msg.includes("未找到 Chrome") ? msg : `启动浏览器失败: ${msg}`,
      "browser_error",
    );
  }

  try {
    const searchResult = await executeSearchPipeline(context, keywords, depth === "deep" ? 3 : 1);
    if (searchResult.length === 0) {
      throw new RednoteError("未找到相关笔记，请尝试其他关键词", "no_results");
    }

    const windowDays = days > 0 ? days : 365;
    const scored = scoreResults(deduplicate(searchResult), topic, windowDays);
    const topItems = scored.slice(0, topN);
    const details = await fetchDetails(context, topItems, depth === "quick" ? 5 : 8, 500);
    const rescored = rescoreWithDesc(topItems, details, topic, windowDays);
    return buildResearchResult({
      topic, keywords, scored: attachDetails(rescored, details), totalSearched: searchResult.length, totalAfterDedup: scored.length, topN,
    });
  } finally {
    await context.close();
  }
}

async function handleLogin(config?: RednoteResearchConfig): Promise<unknown> {
  const timeoutMs = config?.loginTimeoutMs ?? 120_000;
  const success = await waitForLogin(timeoutMs, config?.browser);
  if (success) {
    return { status: "success", message: "登录成功" };
  }
  return { status: "timeout", message: "登录超时，请重试" };
}

async function handleCheckLogin(config?: RednoteResearchConfig): Promise<unknown> {
  const isLoggedIn = await checkLoginStatus(config?.browser);
  return {
    logged_in: isLoggedIn,
    message: isLoggedIn ? "已登录" : "未登录或登录已过期",
  };
}

/**
 * rednote-research MCP Server。
 * 提供小红书一站式关键词搜索和内容调研能力。
 */
export function createRednoteResearchServer(config?: RednoteResearchConfig): MCPServerConfig {
  // 启动时清理过期的浏览器临时目录
  cleanupStaleBrowserProfiles();

  return {
    name: "rednote-research",
    version: "1.0.0",
    tools: [
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
                days: { type: "number", description: "搜索时间范围（天数），0 表示不限" },
                top_n: { type: "number", description: "详情抓取数量，默认 20（quick 模式默认 8）" },
              },
            },
          },
          required: ["topic"],
        },
        handler: async (params) => handleResearchNotes(params, config),
      },
      {
        name: "login",
        description: "打开小红书登录页面，显示二维码等待扫码。超时 120 秒。",
        inputSchema: { type: "object", properties: {} },
        handler: async () => handleLogin(config),
      },
      {
        name: "check_login",
        description: "检查当前小红书登录状态。",
        inputSchema: { type: "object", properties: {} },
        handler: async () => handleCheckLogin(config),
      },
    ],
  };
}
