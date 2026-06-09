/**
 * 消息上下文格式化工具
 *
 * 从 Message 对象中提取可用于 prompt 注入的上下文文本。
 */

import type { Message, MessageContext } from "../types";

/**
 * 格式化消息上下文用于 prompt
 */
export function formatMessageContextForPrompt(message: Message & { context?: MessageContext | null }): string {
  const context = message.context?.context?.trim();
  return context || "(该消息没有产生可用于上下文的最终内容。)";
}
