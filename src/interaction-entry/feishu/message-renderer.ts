import { renderMessageEventsForDisplay } from "../../message-bus/message-events";
import type { MessageEvent } from "../../persistence/store";

export function renderFeishuTextMessage(input: { snailName: string; events: MessageEvent[]; maxLength: number }): string {
  const body = renderMessageEventsForDisplay({ events: input.events }).trim();
  const text = `${input.snailName}:\n${body || "[无可显示内容]"}`.trim();
  if (text.length <= input.maxLength) return text;
  return `${text.slice(0, Math.max(0, input.maxLength - 20))}\n...[已截断]`;
}
