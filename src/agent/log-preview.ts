import type { AgentMessage } from "./interface";
import type { MessagePartInput, MessageWithParts } from "../persistence/store";
import { PartType } from "../persistence/store";
import { joinPartTextByType } from "../project/message-parts";

function fullText(text: string): string {
  return text;
}

export function previewText(text: string): string {
  return fullText(text);
}

export function previewAgentMessages(messages: AgentMessage[]): string {
  return fullText(messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n"));
}

export function previewMessageParts(parts: MessagePartInput[]): string {
  return fullText(joinPartTextByType(parts, [PartType.CONTENT, PartType.ERROR]));
}

export function previewConversationMessages(messages: MessageWithParts[]): string {
  return fullText(
    messages
      .map((message) => `${message.from_snail ?? message.role}: ${joinPartTextByType(message.parts, [PartType.CONTENT, PartType.ERROR])}`)
      .join("\n\n"),
  );
}
