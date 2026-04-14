import type { MessagePart, MessagePartInput, MessageWithParts, SnailName } from "../persistence/store";
import type { SnailDefinition } from "../snails";

type TextLikePart = Pick<MessagePart, "part_type" | "text_value" | "ref_value"> | Pick<MessagePartInput, "part_type" | "text_value" | "ref_value">;

export function getPartText(part: TextLikePart): string {
  if (part.part_type === "mention") {
    return part.text_value ?? (part.ref_value ? `@${part.ref_value}` : "");
  }

  return part.text_value ?? "";
}

export function joinPartText(parts: TextLikePart[]): string {
  return parts.map((part) => getPartText(part)).filter(Boolean).join("");
}

export function joinPartTextByType(
  parts: TextLikePart[],
  allowedTypes: string[]
): string {
  return parts
    .filter((part) => allowedTypes.includes(part.part_type))
    .map((part) => getPartText(part))
    .filter(Boolean)
    .join("\n\n");
}

export interface StructuredMentionLike {
  snail: SnailName;
  raw: string;
}

interface MentionBuildOptions {
  getSnail: (snailName: SnailName) => SnailDefinition | undefined;
  allowSnail: (snailName: SnailName) => boolean;
  partType?: "text" | "result";
}

export function buildMentionParts(
  messageText: string,
  mentions: StructuredMentionLike[],
  options: MentionBuildOptions
): MessagePartInput[] {
  const partType = options.partType ?? "text";
  if (mentions.length === 0) {
    return [{ part_type: partType, text_value: messageText }];
  }

  const candidates = resolveMentionCandidates(messageText, mentions, options);

  if (candidates.length === 0) {
    return [{ part_type: partType, text_value: messageText }];
  }

  return buildStructuredPartsFromCandidates(messageText, candidates, partType);
}

export function prependQuotePart(replyToMessageId: number | null, referenced: MessageWithParts | undefined, parts: MessagePartInput[]): MessagePartInput[] {
  if (!replyToMessageId || !referenced) {
    return parts;
  }

  const preview = buildMessagePreview(referenced);

  return [
    {
      part_type: "quote",
      ref_value: String(replyToMessageId),
      json_value: JSON.stringify({
        message_id: replyToMessageId,
        producer_snail: referenced.producer_snail,
        role: referenced.role,
        preview,
      }),
    },
    ...parts,
  ];
}

// 构建消息预览文本，用于 quote part 和 UI 展示
// maxLength 默认 160 字符，约等于两行文本的长度，足够展示消息要点
export function buildMessagePreview(message: MessageWithParts, maxLength = 160): string {
  return joinPartTextByType(message.parts, ["text", "mention", "quote", "result", "system_event"])
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function resolveMentionCandidates(
  messageText: string,
  mentions: StructuredMentionLike[],
  options: MentionBuildOptions
): Array<{ snail: SnailDefinition; raw: string; start: number; end: number }> {
  return mentions
    .map((mention) => {
      const snail = options.getSnail(mention.snail);
      if (!snail || !options.allowSnail(mention.snail)) {
        return null;
      }
      const raw = mention.raw?.trim() || `@${snail.title}`;
      const index = messageText.indexOf(raw);
      if (index === -1) {
        return null;
      }
      return {
        snail,
        raw,
        start: index,
        end: index + raw.length,
      };
    })
    .filter((item): item is { snail: SnailDefinition; raw: string; start: number; end: number } => Boolean(item))
    .sort((left, right) => left.start - right.start);
}

function buildStructuredPartsFromCandidates(
  messageText: string,
  candidates: Array<{ snail: SnailDefinition; raw: string; start: number; end: number }>,
  partType: "text" | "result"
): MessagePartInput[] {
  const parts: MessagePartInput[] = [];
  let cursor = 0;

  for (const candidate of candidates) {
    if (candidate.start < cursor) {
      continue;
    }
    if (candidate.start > cursor) {
      parts.push({ part_type: partType, text_value: messageText.slice(cursor, candidate.start) });
    }
    parts.push({
      part_type: "mention",
      text_value: candidate.raw,
      ref_value: candidate.snail.name,
      json_value: JSON.stringify({ title: candidate.snail.title }),
    });
    cursor = candidate.end;
  }

  if (cursor < messageText.length) {
    parts.push({ part_type: partType, text_value: messageText.slice(cursor) });
  }

  return parts.filter((part) => part.text_value !== "");
}
