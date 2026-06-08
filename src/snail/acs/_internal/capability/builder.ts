/**
 * ACS 构建器 — 从 SnailTemplate + 运行时上下文组装完整 AgentCapabilitySpec。
 *
 * SnailTemplate 提供静态配置（runtime、model、context_window 等）。
 * SpecBuildContext 提供动态上下文（systemPrompt、systemReminder、skills 等）。
 * 两者合并产出完整的 ACS。
 */

import type { AgentCapabilitySpec } from '../../types.js';
import type { SnailTemplate } from '@/snail/types.js';
import type { SpecBuildContext } from '@/snail/api.js';

/**
 * 组装完整的 AgentCapabilitySpec。
 *
 * @param template - Snail 模板（来自 snail-den.json）
 * @param context - 运行时上下文（由 ConversationService 在编排时提供）
 * @returns 完整的 ACS，可直接传给 SnailRuntime.invokeMessage
 */
export function buildCapabilitySpec(
  template: SnailTemplate,
  context: SpecBuildContext,
): AgentCapabilitySpec {
  return {
    // ─── 来自 template ───
    runtime: template.runtime,
    model: template.model,
    context_window: template.context_window,
    invocation_timeout_ms: template.invocation_timeout_ms,

    // ─── 来自 context ───
    systemPrompt: context.systemPrompt,
    systemReminder: context.systemReminder,
    skills: context.skills,
    mcpServers: context.mcpServers,
    guardProfile: context.guardProfile,
  };
}
