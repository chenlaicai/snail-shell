import type { MCPServerConfig } from "@domain/snail-mcp-server/model";
import { launchContext, checkLoginStatus, waitForLogin } from "@domain/snail-mcp-server/_internal/servers/rednote-research/browser";
import { expandKeywords } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/keywords";
import { searchMultiple } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/search";
import { deduplicate } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/dedup";
import { scoreResults, rescoreWithDesc } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/scoring";
import { fetchDetails } from "@domain/snail-mcp-server/_internal/servers/rednote-research/engine/detail";
import type { SearchResultItem, DetailResult, ResearchResult } from "@domain/snail-mcp-server/_internal/servers/rednote-research/types";

function mcpSuccess(data: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function mcpError(message: string): unknown {
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

async function handleResearchNotes(params: Record<string, unknown>): Promise<unknown> {
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

async function handleLogin(): Promise<unknown> {
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

async function handleCheckLogin(): Promise<unknown> {
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
 * rednote-research MCP Server。
 * 提供小红书一站式关键词搜索和内容调研能力。
 */
export function createRednoteResearchServer(): MCPServerConfig {
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
        handler: async (params) => handleResearchNotes(params),
      },
      {
        name: "login",
        description: "打开小红书登录页面，显示二维码等待扫码。超时 120 秒。",
        inputSchema: { type: "object", properties: {} },
        handler: async () => handleLogin(),
      },
      {
        name: "check_login",
        description: "检查当前小红书登录状态。",
        inputSchema: { type: "object", properties: {} },
        handler: async () => handleCheckLogin(),
      },
    ],
  };
}
