/**
 * Rednote Research 纯函数单元测试。
 *
 * 从源文件导入函数，确保测试与实现同步。
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseCount } from "../../src/mcp/rednote-research/engine/search";
import { classifyQuery, expandKeywords, extractCore } from "../../src/mcp/rednote-research/engine/keywords";
import { dedupById, dedupByTitle } from "../../src/mcp/rednote-research/engine/dedup";
import { scoreResults, toBigrams } from "../../src/mcp/rednote-research/engine/scoring";
import type { SearchResultItem } from "../../src/mcp/rednote-research/types";

// ═══════════════════════════════════════════════════════════
// helpers
// ═══════════════════════════════════════════════════════════

function makeItem(id: string, title: string, likes = 0): SearchResultItem {
  return { id, xsecToken: "", title, author: "", authorId: "", likes, comments: 0, favorites: 0, score: 0, relevance: 0, recency: 0, engagement: 0 };
}

// ═══════════════════════════════════════════════════════════
// parseCount
// ═══════════════════════════════════════════════════════════

describe("parseCount", () => {
  it("parses plain numbers", () => {
    assert.strictEqual(parseCount("1234"), 1234);
    assert.strictEqual(parseCount("0"), 0);
  });
  it("parses 万", () => {
    assert.strictEqual(parseCount("1.5万"), 15000);
    assert.strictEqual(parseCount("10万"), 100000);
    assert.strictEqual(parseCount("0.5万"), 5000);
  });
  it("parses 亿", () => {
    assert.strictEqual(parseCount("1亿"), 100000000);
    assert.strictEqual(parseCount("1.5亿"), 150000000);
  });
  it("handles undefined and empty", () => {
    assert.strictEqual(parseCount(undefined), 0);
    assert.strictEqual(parseCount(""), 0);
  });
  it("handles non-numeric", () => {
    assert.strictEqual(parseCount("abc"), 0);
  });
  it("handles negative numbers", () => {
    assert.strictEqual(parseCount("-1"), -1);
  });
});

// ═══════════════════════════════════════════════════════════
// classifyQuery
// ═══════════════════════════════════════════════════════════

describe("classifyQuery", () => {
  it("classifies 推荐", () => {
    assert.strictEqual(classifyQuery("咖啡机推荐"), "推荐");
    assert.strictEqual(classifyQuery("求推荐好用的耳机"), "推荐");
  });
  it("classifies 测评", () => {
    assert.strictEqual(classifyQuery("iPhone vs Samsung 测评"), "测评");
  });
  it("classifies 攻略", () => {
    assert.strictEqual(classifyQuery("新手入门攻略"), "攻略");
    assert.strictEqual(classifyQuery("怎么做咖啡"), "攻略");
  });
  it("classifies 避雷", () => {
    assert.strictEqual(classifyQuery("咖啡机避雷"), "避雷");
    assert.strictEqual(classifyQuery("别买这个品牌"), "避雷");
  });
  it("classifies 调研", () => {
    assert.strictEqual(classifyQuery("调研AI绘画市场"), "调研");
  });
  it("defaults to 通用", () => {
    assert.strictEqual(classifyQuery("咖啡"), "通用");
  });
  it("returns first matching intent when multiple match", () => {
    // "推荐" 在 patterns 中排在 "避雷" 之前
    assert.strictEqual(classifyQuery("推荐避雷"), "推荐");
  });
});

// ═══════════════════════════════════════════════════════════
// extractCore
// ═══════════════════════════════════════════════════════════

describe("extractCore", () => {
  it("removes leading noise word", () => {
    assert.strictEqual(extractCore("求推荐咖啡机"), "咖啡机");
  });
  it("removes trailing noise word", () => {
    assert.strictEqual(extractCore("咖啡机推荐"), "咖啡机");
  });
  it("removes both leading and trailing", () => {
    assert.strictEqual(extractCore("求推荐咖啡机推荐"), "咖啡机");
  });
  it("handles pure noise words", () => {
    assert.strictEqual(extractCore("推荐"), "推荐");
  });
  it("does not remove middle noise words", () => {
    // "最好" 在开头被移除，"推荐" 在结尾被移除，"的" 在中间保留
    assert.strictEqual(extractCore("最好的咖啡机推荐"), "的咖啡机");
  });
  it("loops to strip chained leading noise", () => {
    // "求" → strip → "推荐" → strip → "咖啡机"
    assert.strictEqual(extractCore("求推荐咖啡机"), "咖啡机");
  });
});

// ═══════════════════════════════════════════════════════════
// expandKeywords
// ═══════════════════════════════════════════════════════════

describe("expandKeywords", () => {
  it("generates multiple keywords", () => {
    const kws = expandKeywords("咖啡机推荐");
    assert.ok(kws.length >= 3);
    assert.ok(kws.includes("咖啡机推荐"));
  });
  it("handles empty-ish input", () => {
    const kws = expandKeywords("推荐");
    assert.ok(kws.length >= 1);
  });
});

// ═══════════════════════════════════════════════════════════
// dedupById / dedupByTitle
// ═══════════════════════════════════════════════════════════

describe("dedupById", () => {
  it("removes duplicate ids", () => {
    const items = [makeItem("a", "title1"), makeItem("b", "title2"), makeItem("a", "title3")];
    const result = dedupById(items);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, "a");
    assert.strictEqual(result[0].title, "title1");
  });
  it("handles empty array", () => {
    assert.deepStrictEqual(dedupById([]), []);
  });
});

describe("dedupByTitle", () => {
  it("removes similar titles", () => {
    const items = [
      makeItem("a", "推荐家用小型咖啡机", 100),
      makeItem("b", "推荐家用小型咖啡壶", 50),
      makeItem("c", "完全不同的标题内容", 200),
    ];
    const result = dedupByTitle(items);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, "c");
    assert.strictEqual(result[1].id, "a");
  });
  it("keeps dissimilar titles", () => {
    const items = [makeItem("a", "咖啡机推荐"), makeItem("b", "手机壳选购")];
    const result = dedupByTitle(items);
    assert.strictEqual(result.length, 2);
  });
  it("handles empty titles", () => {
    const items = [makeItem("a", ""), makeItem("b", "")];
    const result = dedupByTitle(items);
    assert.strictEqual(result.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════
// toBigrams
// ═══════════════════════════════════════════════════════════

describe("toBigrams", () => {
  it("generates character bigrams", () => {
    const bgs = toBigrams("咖啡机");
    assert.ok(bgs.has("咖啡"));
    assert.ok(bgs.has("啡机"));
    assert.strictEqual(bgs.size, 2);
  });
  it("filters stop chars", () => {
    const bgs = toBigrams("我的咖啡机");
    // "的" 是停用字，包含 "的" 的 bigram "我的" 和 "的咖" 都应被过滤
    assert.ok(!bgs.has("我的"));
    assert.ok(!bgs.has("的咖"));
    assert.ok(bgs.has("咖啡"));
    assert.ok(bgs.has("啡机"));
  });
  it("handles empty string", () => {
    assert.strictEqual(toBigrams("").size, 0);
  });
  it("handles single char", () => {
    assert.strictEqual(toBigrams("咖").size, 0);
  });
  it("filters all-stop-char input", () => {
    const bgs = toBigrams("的了");
    assert.strictEqual(bgs.size, 0);
  });
});

// ═══════════════════════════════════════════════════════════
// scoreResults
// ═══════════════════════════════════════════════════════════

describe("scoreResults", () => {
  it("scores and sorts by relevance + engagement", () => {
    const items = [
      makeItem("a", "咖啡机推荐", 100),
      makeItem("b", "手机壳选购", 1000),
      makeItem("c", "家用咖啡机攻略", 50),
    ];
    const result = scoreResults(items, "咖啡机推荐");
    assert.strictEqual(result[0].id, "a");
    assert.ok(result[0].score > result[1].score);
  });
  it("handles empty array", () => {
    assert.deepStrictEqual(scoreResults([], "test"), []);
  });
  it("handles single item", () => {
    const result = scoreResults([makeItem("a", "test", 10)], "test");
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].score > 0);
  });
  it("handles all-zero engagement", () => {
    const items = [makeItem("a", "咖啡机推荐", 0), makeItem("b", "咖啡机攻略", 0)];
    const result = scoreResults(items, "咖啡机");
    assert.strictEqual(result.length, 2);
    assert.ok(isFinite(result[0].score));
  });
});
