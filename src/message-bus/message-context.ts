import type {
  ContentBlockEventPayload,
  ErrorEventPayload,
  Message,
  MessageContextKind,
  MessageEvent,
  MessageSignalType,
  SignalEventPayload,
} from "../persistence/types";
import type { MessageContextSummaryGenerator } from "../shared/types";
import { logger } from "../logger";
import { extractTextFromBlocks } from "./message-events";
import { extractEmbeddedMessageOutCandidate, parseMessageOutPayload } from "./message-out";

export { formatMessageContextForPrompt } from "../shared/message-context-utils";

export const MESSAGE_CONTEXT_LLM_SUMMARY_THRESHOLD_CHARS = 12000;
export const MESSAGE_CONTEXT_LLM_SUMMARY_TARGET_CHARS = 3000;
const MESSAGE_CONTEXT_FALLBACK_TRUNCATE_CHARS = MESSAGE_CONTEXT_LLM_SUMMARY_THRESHOLD_CHARS;

export interface BuiltMessageContext {
  kind: MessageContextKind;
  context: string;
}

export async function buildTerminalMessageContext(input: {
  message: Message;
  events: MessageEvent[];
  summaryGenerator?: MessageContextSummaryGenerator | null;
}): Promise<BuiltMessageContext> {
  const base = buildDeterministicMessageContext(input.message, input.events);
  if (base.context.length <= MESSAGE_CONTEXT_LLM_SUMMARY_THRESHOLD_CHARS) return base;

  if (input.summaryGenerator) {
    try {
      const summarized = await input.summaryGenerator.generateMessageContextSummary({
        context: base.context,
        targetChars: MESSAGE_CONTEXT_LLM_SUMMARY_TARGET_CHARS,
      });
      const normalized = summarized.trim();
      if (normalized) return { kind: "llm_summary", context: normalized };
    } catch (error) {
      logger.warn("Message context LLM summary failed; using deterministic truncation", {
        messageId: input.message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ...base, context: truncateContext(base.context, MESSAGE_CONTEXT_FALLBACK_TRUNCATE_CHARS) };
}

export function buildDeterministicMessageContext(message: Message, events: MessageEvent[]): BuiltMessageContext {
  const finalOutput = findFinalOutputText(events);
  if (finalOutput) return finalOutput;

  return { kind: "event_summary", context: buildEventSummary(message, events) };
}

function findFinalOutputText(events: MessageEvent[]): BuiltMessageContext | null {
  for (const event of [...events].reverse()) {
    if (event.kind === "content_block") {
      const text = getContentBlockContextText(event.payload).trim();
      if (text) return { kind: "message_out", context: text };
    }

    if (event.kind === "text") {
      const messageOutText = extractMessageOutText(event.payload.text).trim();
      if (messageOutText) return { kind: "message_out", context: messageOutText };

      const text = event.payload.text.trim();
      if (text) return { kind: "final_text", context: text };
    }
  }
  return null;
}

function extractMessageOutText(text: string): string {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith("{") ? trimmed : extractEmbeddedMessageOutCandidate(trimmed);
  if (!candidate) return "";
  try {
    const event = parseMessageOutPayload(candidate);
    if (event.kind !== "content_block") return "";
    return getContentBlockContextText(event.payload);
  } catch {
    return "";
  }
}

function getContentBlockContextText(payload: ContentBlockEventPayload): string {
  return (payload.fallback_text ?? extractTextFromBlocks(payload.blocks)).trim();
}

function buildEventSummary(message: Message, events: MessageEvent[]): string {
  const parts: string[] = [];
  parts.push(`该消息没有最终文本答复；最终状态为 ${message.status}。`);

  const errorText = findErrorText(events);
  if (errorText) parts.push(`错误信息：${errorText}`);

  const toolCalls = events.filter((event) => event.kind === "tool_call");
  const toolResults = events.filter((event) => event.kind === "tool_result");
  const commandCalls = events.filter((event) => event.kind === "command");
  const commandResults = events.filter((event) => event.kind === "command_result");
  const failedResults = [...toolResults, ...commandResults].filter((event) => Boolean((event.payload as any).is_error));
  const terminalSignal = findTerminalSignal(events);

  const processParts = [
    toolCalls.length ? `${toolCalls.length} 次工具调用` : "",
    commandCalls.length ? `${commandCalls.length} 次命令执行` : "",
    failedResults.length ? `${failedResults.length} 个失败结果` : "",
  ].filter(Boolean);
  if (processParts.length) parts.push(`过程包含${processParts.join("、")}。`);

  const recentResult = findRecentResultText([...toolResults, ...commandResults]);
  if (recentResult) parts.push(`最近结果：${recentResult}`);
  if (terminalSignal?.reason) parts.push(`终止原因：${terminalSignal.reason}`);
  if (parts.length === 1) parts.push("事件流中没有可提取的工具、命令或错误细节。");

  return parts.join("\n");
}

function findErrorText(events: MessageEvent[]): string | null {
  for (const event of [...events].reverse()) {
    const text = extractErrorText(event);
    if (text) return text;
  }
  return null;
}

function extractErrorText(event: MessageEvent): string | null {
  if (event.kind === "error") return truncateInline((event.payload as ErrorEventPayload).message);
  if (event.kind === "signal" && event.payload.type === "message_failed" && event.payload.reason) return truncateInline(event.payload.reason);
  if (!isFailedResultEvent(event)) return null;
  return truncateInline(getResultText(event));
}

function isFailedResultEvent(event: MessageEvent): event is Extract<MessageEvent, { kind: "tool_result" | "command_result" }> {
  return (event.kind === "tool_result" || event.kind === "command_result") && event.payload.is_error;
}

function findTerminalSignal(events: MessageEvent[]): SignalEventPayload | null {
  const terminalTypes: MessageSignalType[] = ["message_completed", "message_failed", "message_interrupted", "message_cancelled"];
  for (const event of [...events].reverse()) {
    if (event.kind === "signal" && terminalTypes.includes(event.payload.type)) return event.payload;
  }
  return null;
}

function findRecentResultText(events: MessageEvent[]): string | null {
  for (const event of [...events].reverse()) {
    const text = getResultText(event);
    const normalized = truncateInline(text);
    if (normalized) return normalized;
  }
  return null;
}

function getResultText(event: MessageEvent): string {
  if (event.kind === "tool_result") return event.payload.error_text ?? event.payload.output_text ?? "";
  if (event.kind === "command_result") return event.payload.output_text ?? "";
  return "";
}

function truncateInline(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 500 ? `${normalized.slice(0, 500).trimEnd()}...` : normalized;
}

function truncateContext(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  /**
   * LLM 摘要失败时仍必须限制单条消息进入 stateless prompt 的最大尺寸，
   * 否则一个异常日志事件就可能挤掉当前阶段、用户指令和近期上下文。
   */
  return `${text.slice(0, Math.max(0, maxLength - 80)).trimEnd()}\n\n[上下文因摘要不可用被安全截断]`;
}
