/**
 * 关键词扩展引擎。
 *
 * 分析查询意图，生成 5-8 个搜索关键词。
 * 复用 xhs-research 的策略，TypeScript 重写。
 */

import type { QueryIntent } from "@domain/snail-mcp-server/_internal/servers/rednote-research/types";

/** 查询意图 → 关键模式映射 */
const INTENT_PATTERNS: Array<{ intent: QueryIntent; patterns: string[] }> = [
  { intent: "推荐", patterns: ["推荐", "最好", "最佳", "top", "排名", "哪个好", "求推荐", "有没有好的"] },
  { intent: "测评", patterns: ["测评", "评测", "对比", "vs", "versus", "区别"] },
  { intent: "攻略", patterns: ["攻略", "教程", "怎么", "如何", "方法", "步骤", "流程", "指南"] },
  { intent: "避雷", patterns: ["避雷", "踩坑", "不推荐", "别买", "差评", "吐槽", "不要"] },
  { intent: "产品调研", patterns: ["产品调研", "用户体验", "使用场景", "为什么用", "怎么评价"] },
  { intent: "竞品调研", patterns: ["竞品", "竞争", "赛道", "格局", "市场份额"] },
  { intent: "需求调研", patterns: ["痛点", "需求", "想要", "希望", "缺", "不足", "改进", "建议"] },
  { intent: "调研", patterns: ["调研", "分析", "场景", "市场", "用户"] },
];

/** 噪音词（剥离后提取核心主题） */
const NOISE_WORDS = new Set(["推荐", "最好", "最佳", "求", "有没有", "哪个", "怎么样", "吗", "请问", "想问"]);

/** 意图 → 扩展后缀 */
const INTENT_SUFFIXES: Record<QueryIntent | "通用", string[]> = {
  推荐: ["推荐", "攻略", "排名", "避雷", "种草"],
  测评: ["测评", "对比", "体验", "优缺点"],
  攻略: ["攻略", "教程", "新手", "小白"],
  避雷: ["踩坑", "不推荐", "吐槽", "推荐"],
  产品调研: ["体验", "吐槽", "优缺点", "使用场景", "推荐"],
  竞品调研: ["推荐", "对比", "排名", "哪个好", "怎么选"],
  需求调研: ["痛点", "吐槽", "希望", "建议", "体验"],
  调研: ["推荐", "攻略", "体验", "痛点"],
  通用: ["推荐", "攻略", "体验"],
};

/**
 * 分类查询意图。
 */
export function classifyQuery(topic: string): QueryIntent {
  const lower = topic.toLowerCase();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (lower.includes(p)) return intent;
    }
  }
  return "通用";
}

/**
 * 剥离首尾噪音词，提取核心主题词。
 * 只移除位于开头或结尾的噪音词，避免中间词被误删导致语法不通。
 */
export function extractCore(topic: string): string {
  let core = topic.trim();
  const sorted = [...NOISE_WORDS].sort((a, b) => b.length - a.length);
  // 循环剥离首尾噪音词直到稳定（如 "求推荐咖啡机" → "推荐咖啡机" → "咖啡机"）
  let prev = "";
  while (core !== prev) {
    prev = core;
    for (const w of sorted) {
      if (core.startsWith(w)) core = core.slice(w.length);
    }
    for (const w of sorted) {
      if (core.endsWith(w)) core = core.slice(0, -w.length);
    }
  }
  return core.trim() || topic.trim();
}

/**
 * 扩展关键词。
 *
 * @param topic 用户输入的调研主题
 * @returns 5-8 个搜索关键词
 */
export function expandKeywords(topic: string): string[] {
  const intent = classifyQuery(topic);
  const core = extractCore(topic);
  const suffixes = INTENT_SUFFIXES[intent];

  const keywords = new Set<string>();
  keywords.add(topic.trim());

  for (const suffix of suffixes) {
    if (suffix !== topic.trim()) {
      keywords.add(core ? `${core} ${suffix}` : suffix);
    }
  }

  // 去掉与原始主题完全相同的扩展
  keywords.delete("");
  return [...keywords].slice(0, 8);
}
