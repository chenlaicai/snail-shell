import type { MessageContentBlock, ContentBlockEventPayload, CreateMessageEventInput } from "./domain-types";

/**
 * Extract a plain-text representation from an array of content blocks.
 * Used to produce fallback text for content_block events and for
 * rendering structured user input into prompt-compatible strings.
 */
export function extractTextFromBlocks(blocks: MessageContentBlock[]): string {
  return blocks.map(extractTextFromBlock).filter(Boolean).join("\n\n").trim();
}

/**
 * Extract the best available text content from a single event.
 * Handles both "text" events (straight text payload) and "content_block"
 * events (structured blocks that need flattening). Other event kinds
 * return an empty string since they don't carry user-authored content.
 *
 * This is intentionally narrow: it only extracts user-visible text, not
 * machine-facing payloads like tool_call args or command strings, because
 * those semantics belong to their respective renderers / runtime adapters.
 */
export function extractEventText(event: CreateMessageEventInput): string {
  if (event.kind === "text") return event.payload.text;
  if (event.kind === "content_block") return getContentBlockText(event.payload);
  return "";
}

// ── private helpers ─────────────────────────────────────────────

function extractTextFromBlock(block: MessageContentBlock): string {
  const extractor = blockTextExtractors[block.type] as ((value: MessageContentBlock) => string) | undefined;
  return extractor ? extractor(block) : "";
}

function getContentBlockText(payload: ContentBlockEventPayload): string {
  return payload.fallback_text ?? extractTextFromBlocks(payload.blocks);
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
