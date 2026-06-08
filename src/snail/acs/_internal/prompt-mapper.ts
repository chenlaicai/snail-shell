/**
 * ACS 消息构建器 — 将 SnailRuntimeMessageInput 翻译为 agent 能理解的消息格式。
 *
 * 覆盖两个场景：
 * - bootstrap（首次调用）：systemPrompt + history（去掉最新 user 消息）
 * - incremental（每次调用）：本轮 inbox 消息
 *
 * systemPrompt 的注入方式由 adapter 决定（Claude: --append-system-prompt-file）。
 * systemReminder 的注入方式由 adapter 决定（写入 user message 前缀）。
 */

import type { AgentMessage, SnailRuntimeMessageInput } from '../runtime.js';

// ═══════════════════════════════════════════════════════════
// Bootstrap（首次调用）
// ═══════════════════════════════════════════════════════════

/**
 * 构建 bootstrap 消息（首次调用时注入 agent session）。
 *
 * 去掉 history 中最后一条 user 消息，因为它会作为 incrementalMessages 的一部分发送。
 * 这样 agent 不会收到重复的 user 消息。
 */
export function buildBootstrapMessages(history: AgentMessage[]): AgentMessage[] {
  return dropLatestUserMessage(history);
}

/**
 * 从 history 中移除最后一条 user 消息。
 */
function dropLatestUserMessage(history: AgentMessage[]): AgentMessage[] {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === 'user') {
      return history.filter((_, idx) => idx !== i);
    }
  }
  return [...history];
}

// ═══════════════════════════════════════════════════════════
// Incremental（每次调用）
// ═══════════════════════════════════════════════════════════

/**
 * 构建增量消息（本轮 inbox）。
 *
 * 过滤掉 system 角色消息（system 消息不直接发给 agent）。
 */
export function buildIncrementalMessages(input: SnailRuntimeMessageInput): AgentMessage[] {
  return input.incrementalMessages.filter(
    (msg) => msg.role === 'user' || msg.role === 'assistant',
  );
}

// ═══════════════════════════════════════════════════════════
// User content 组装（Claude Code stdin 格式）
// ═══════════════════════════════════════════════════════════

/**
 * 构建 Claude Code 的 user message content。
 *
 * systemPrompt 不在此处——它通过 --append-system-prompt-file 注入。
 * systemReminder 包裹在 <system-reminder> 标签中，作为 user message 前缀。
 */
export function buildUserContent(
  systemReminder: string,
  bootstrapMessages: AgentMessage[],
  incrementalMessages: AgentMessage[],
): string {
  const parts: string[] = [];

  if (systemReminder) {
    parts.push(`<system-reminder>\n${systemReminder}\n</system-reminder>`);
  }

  for (const msg of bootstrapMessages) {
    parts.push(msg.content);
  }

  for (const msg of incrementalMessages) {
    parts.push(msg.content);
  }

  return parts.join('\n\n');
}
