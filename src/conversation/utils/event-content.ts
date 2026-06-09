/**
 * 事件内容文本提取工具
 *
 * 从结构化内容块和事件中提取纯文本。
 * 用于生成 fallback 文本、prompt 化内容、搜索索引等。
 */

import type { MessageContentBlock } from "../types/content-blocks";

/**
 * 从内容块数组提取纯文本
 */
export function extractTextFromBlocks(blocks: MessageContentBlock[]): string {
  return blocks.map(extractTextFromBlock).filter(Boolean).join("\n\n").trim();
}

/**
 * 从单个事件提取文本
 */
export function extractEventText(event: { kind: string; payload: Record<string, unknown> }): string {
  if (event.kind === "text") return event.payload.text as string;
  if (event.kind === "content_block") return getContentBlockText(event.payload);
  return "";
}

// ── private helpers ─────────────────────────────────────────────

function extractTextFromBlock(block: MessageContentBlock): string {
  const extractor = blockTextExtractors[block.type] as ((value: MessageContentBlock) => string) | undefined;
  return extractor ? extractor(block) : "";
}

function getContentBlockText(payload: Record<string, unknown>): string {
  return (payload.fallback_text as string) ?? extractTextFromBlocks(payload.blocks as MessageContentBlock[]);
}

const blockTextExtractors: Record<MessageContentBlock["type"], (block: MessageContentBlock) => string> = {
  text: (block) => block.type === "text" ? block.text : "",
  rich_text: (block) => block.type === "rich_text" ? block.text : "",
  markdown: (block) => block.type === "markdown" ? block.text : "",
  question: (block) => block.type === "question" ? [block.title, block.question, block.reason ?? ""].filter(Boolean).join("\n") : "",
  question_response: (block) => block.type === "question_response" ? block.summary : "",
  image: (block) => block.type === "image" ? block.alt ?? "" : "",
  icon: (block) => block.type === "icon" ? block.label ?? block.name : "",
  chart: (block) => block.type === "chart" ? block.title ?? "" : "",
  table: (block) => block.type === "table" ? [block.title ?? "", block.columns.join(" ")].filter(Boolean).join("\n") : "",
  tool_call_card: (block) => block.type === "tool_call_card" ? block.summary ?? block.detail ?? block.tool_name : "",
  artifact_card: (block) => block.type === "artifact_card" ? [block.title, block.summary ?? ""].filter(Boolean).join("\n") : "",
  reference_card: (block) => block.type === "reference_card" ? [block.title, block.summary ?? ""].filter(Boolean).join("\n") : "",
};
