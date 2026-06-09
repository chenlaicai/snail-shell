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

const blockTextExtractors: Record<MessageContentBlock["type"], (block: any) => string> = {
  text: (block) => block.text,
  rich_text: (block) => block.text,
  markdown: (block) => block.text,
  question: (block) => [block.title, block.question, block.reason ?? ""].filter(Boolean).join("\n"),
  question_response: (block) => block.summary,
  image: (block) => block.alt ?? "",
  icon: (block) => block.label ?? block.name,
  chart: (block) => block.title ?? "",
  table: (block) => [block.title ?? "", block.columns.join(" ")].filter(Boolean).join("\n"),
  tool_call_card: (block) => block.summary ?? block.detail ?? block.tool_name,
  artifact_card: (block) => [block.title, block.summary ?? ""].filter(Boolean).join("\n"),
  reference_card: (block) => [block.title, block.summary ?? ""].filter(Boolean).join("\n"),
};
