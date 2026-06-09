import type { Message, MessageContext } from "./domain-types";

export function formatMessageContextForPrompt(message: Message & { context?: MessageContext | null }): string {
  const context = message.context?.context?.trim();
  return context || "(该消息没有产生可用于上下文的最终内容。)";
}
