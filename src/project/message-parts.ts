import type { MessagePart, MessagePartInput, MessageWithParts, SnailName } from "../persistence/store";

type TextLikePart = Pick<MessagePart, "part_type" | "text_value"> | Pick<MessagePartInput, "part_type" | "text_value">;

export function getPartText(part: TextLikePart): string {
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

export function buildContentPartWithMentions(
  content: string,
  mentions?: SnailName[]
): MessagePartInput {
  return {
    part_type: "content",
    text_value: content,
    mentions,
  };
}

export function buildMessagePreview(message: MessageWithParts, maxLength = 160): string {
  const primaryText = joinPartTextByType(message.parts, ["content"]) || joinPartTextByType(message.parts, ["error"]);
  return primaryText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
