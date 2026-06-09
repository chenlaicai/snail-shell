// MessageEvent 类型已迁移到 conversation 模块，暂时内联定义
interface MessageEvent {
  id: number;
  message_id: number;
  seq: number;
  category: string;
  kind: string;
  payload: Record<string, unknown>;
  source: string;
  created_at: string;
}

// renderMessageEventsForDisplay 已迁移到 conversation 模块，暂时内联实现
function renderMessageEventsForDisplay(input: { events: MessageEvent[] }): string {
  return input.events
    .filter((e) => e.kind === "text")
    .map((e) => (e.payload as Record<string, unknown>).text as string || "")
    .join("\n");
}

export function renderFeishuTextMessage(input: { roleName: string; events: MessageEvent[]; maxLength: number }): string {
  const body = renderMessageEventsForDisplay({ events: input.events }).trim();
  const text = `${input.roleName}:\n${body || "[无可显示内容]"}`.trim();
  if (text.length <= input.maxLength) return text;
  return `${text.slice(0, Math.max(0, input.maxLength - 20))}\n...[已截断]`;
}
