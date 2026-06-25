import type { AgentEvent, LifecycleSignal } from "@infra/acs/model";

interface RuntimeUsageDetail {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  context_window: number | null;
  context_window_source: "runtime" | "builtin" | "unknown";
  context_usage_ratio: number | null;
  output_token_ratio: number | null;
  raw: Record<string, unknown>;
}

export function buildRuntimeUsageSignal(detail: RuntimeUsageDetail, runtimeEventType: string): AgentEvent {
  return {
    type: "message_event",
    event: {
      kind: "signal",
      payload: {
        signal_type: "runtime_usage" as LifecycleSignal,
        data: {
          reason: usageReason(detail),
          detail: detail as unknown as Record<string, unknown>,
        },
      },
      source: { runtime_event_type: runtimeEventType, runtime_message_id: null },
    },
  };
}

export function usageDetailFromClaudeResult(result: unknown, builtinContextWindow?: number | null): RuntimeUsageDetail | null {
  if (!isRecord(result)) return null;
  const usage = isRecord(result.usage) ? result.usage : null;
  const modelUsage = firstModelUsage(result.modelUsage);
  if (!usage && !modelUsage) return null;

  const inputTokens = readUsageNumber(modelUsage, usage, "inputTokens", "input_tokens");
  const outputTokens = readUsageNumber(modelUsage, usage, "outputTokens", "output_tokens");
  const cachedInputTokens = readUsageNumber(modelUsage, usage, "cacheReadInputTokens", "cache_read_input_tokens");
  const cacheWriteTokens = readUsageNumber(modelUsage, usage, "cacheCreationInputTokens", "cache_creation_input_tokens");
  const runtimeContextWindow = readNumber(modelUsage?.contextWindow);
  const contextWindow = runtimeContextWindow ?? builtinContextWindow ?? null;
  return withDerivedRatios({
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: readUsageNumber(modelUsage, usage, "totalTokens", "total_tokens"),
    cached_input_tokens: cachedInputTokens,
    cache_write_tokens: cacheWriteTokens,
    reasoning_tokens: null,
    context_window: contextWindow,
    context_window_source: contextWindowSource(runtimeContextWindow, contextWindow),
    context_usage_ratio: null,
    output_token_ratio: null,
    raw: { usage, modelUsage },
  });
}

export function usageDetailFromCodexUsage(usage: unknown, builtinContextWindow?: number | null): RuntimeUsageDetail | null {
  if (!isRecord(usage)) return null;
  const runtimeContextWindow = readNumber(usage.context_window) ?? readNumber(usage.contextWindow);
  const contextWindow = runtimeContextWindow ?? builtinContextWindow ?? null;
  return withDerivedRatios({
    input_tokens: readNumber(usage.input_tokens),
    output_tokens: readNumber(usage.output_tokens),
    total_tokens: readNumber(usage.total_tokens),
    cached_input_tokens: readNumber(usage.cached_input_tokens),
    cache_write_tokens: null,
    reasoning_tokens: readNumber(usage.reasoning_tokens),
    context_window: contextWindow,
    context_window_source: contextWindowSource(runtimeContextWindow, contextWindow),
    context_usage_ratio: null,
    output_token_ratio: null,
    raw: usage,
  });
}

export function usageDetailFromOpenCodeTokens(tokens: unknown, builtinContextWindow?: number | null): RuntimeUsageDetail | null {
  if (!isRecord(tokens)) return null;
  const runtimeContextWindow = readNumber(tokens.context_window) ?? readNumber(tokens.contextWindow);
  const contextWindow = runtimeContextWindow ?? builtinContextWindow ?? null;
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  return withDerivedRatios({
    input_tokens: readNumber(tokens.input),
    output_tokens: readNumber(tokens.output),
    total_tokens: readNumber(tokens.total),
    cached_input_tokens: readNumber(cache.read),
    cache_write_tokens: readNumber(cache.write),
    reasoning_tokens: readNumber(tokens.reasoning),
    context_window: contextWindow,
    context_window_source: contextWindowSource(runtimeContextWindow, contextWindow),
    context_usage_ratio: null,
    output_token_ratio: null,
    raw: tokens,
  });
}

function contextWindowSource(runtimeContextWindow: number | null, resolvedContextWindow: number | null): "runtime" | "builtin" | "unknown" {
  if (typeof runtimeContextWindow === "number" && runtimeContextWindow > 0) return "runtime";
  if (typeof resolvedContextWindow === "number" && resolvedContextWindow > 0) return "builtin";
  return "unknown";
}

function readUsageNumber(modelUsage: Record<string, unknown> | null, usage: Record<string, unknown> | null, modelKey: string, usageKey: string): number | null {
  return readNumber(modelUsage?.[modelKey]) ?? readNumber(usage?.[usageKey]);
}

function withDerivedRatios(detail: RuntimeUsageDetail): RuntimeUsageDetail {
  const contextTokens = contextUsedTokens(detail);
  return {
    ...detail,
    context_usage_ratio: ratio(contextTokens, detail.context_window),
    output_token_ratio: ratio(detail.output_tokens, detail.total_tokens),
  };
}

function contextUsedTokens(detail: RuntimeUsageDetail): number | null {
  return detail.total_tokens ?? sumPair(detail.input_tokens, detail.output_tokens);
}

function sumPair(left: number | null, right: number | null): number | null {
  return typeof left === "number" && typeof right === "number" ? left + right : null;
}

function usageReason(detail: RuntimeUsageDetail): string | null {
  if (detail.output_tokens === 0 && (detail.input_tokens ?? 0) > 0) return "zero_output_tokens";
  if (typeof detail.context_usage_ratio === "number" && detail.context_usage_ratio >= 0.9) return "context_near_limit";
  return null;
}

function firstModelUsage(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  for (const item of Object.values(value)) {
    if (isRecord(item)) return item;
  }
  return null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (typeof numerator !== "number" || typeof denominator !== "number" || denominator <= 0) return null;
  return numerator / denominator;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
