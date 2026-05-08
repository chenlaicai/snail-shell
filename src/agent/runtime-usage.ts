import type { CreateMessageEventInput } from "../persistence/store";

export interface RuntimeUsageDetail {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  context_window: number | null;
  context_usage_ratio: number | null;
  output_token_ratio: number | null;
  raw: Record<string, unknown>;
}

export function buildRuntimeUsageSignal(detail: RuntimeUsageDetail, runtimeEventType: string): CreateMessageEventInput {
  return {
    kind: "signal",
    payload: {
      type: "runtime_usage",
      reason: usageReason(detail),
      detail: detail as unknown as Record<string, unknown>,
    },
    source: { runtime_event_type: runtimeEventType },
  };
}

export function usageDetailFromOpenCodeTokens(tokens: unknown): RuntimeUsageDetail | null {
  if (!isRecord(tokens)) return null;
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  return withDerivedRatios({
    input_tokens: readNumber(tokens.input),
    output_tokens: readNumber(tokens.output),
    total_tokens: readNumber(tokens.total),
    cached_input_tokens: readNumber(cache.read),
    cache_write_tokens: readNumber(cache.write),
    reasoning_tokens: readNumber(tokens.reasoning),
    context_window: null,
    context_usage_ratio: null,
    output_token_ratio: null,
    raw: tokens,
  });
}

export function usageDetailFromCodexUsage(usage: unknown): RuntimeUsageDetail | null {
  if (!isRecord(usage)) return null;
  return withDerivedRatios({
    input_tokens: readNumber(usage.input_tokens),
    output_tokens: readNumber(usage.output_tokens),
    total_tokens: sumKnown(readNumber(usage.input_tokens), readNumber(usage.output_tokens)),
    cached_input_tokens: readNumber(usage.cached_input_tokens),
    cache_write_tokens: null,
    reasoning_tokens: readNumber(usage.reasoning_tokens),
    context_window: readNumber(usage.context_window),
    context_usage_ratio: null,
    output_token_ratio: null,
    raw: usage,
  });
}

export function usageDetailFromClaudeResult(result: unknown): RuntimeUsageDetail | null {
  if (!isRecord(result)) return null;
  const usage = isRecord(result.usage) ? result.usage : null;
  const modelUsage = firstModelUsage(result.modelUsage);
  if (!usage && !modelUsage) return null;

  const inputTokens = readUsageNumber(modelUsage, usage, "inputTokens", "input_tokens");
  const outputTokens = readUsageNumber(modelUsage, usage, "outputTokens", "output_tokens");
  const cachedInputTokens = readUsageNumber(modelUsage, usage, "cacheReadInputTokens", "cache_read_input_tokens");
  const cacheWriteTokens = readUsageNumber(modelUsage, usage, "cacheCreationInputTokens", "cache_creation_input_tokens");
  return withDerivedRatios({
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: sumKnown(inputTokens, outputTokens),
    cached_input_tokens: cachedInputTokens,
    cache_write_tokens: cacheWriteTokens,
    reasoning_tokens: null,
    context_window: readNumber(modelUsage?.contextWindow),
    context_usage_ratio: null,
    output_token_ratio: null,
    raw: result,
  });
}

function readUsageNumber(modelUsage: Record<string, unknown> | null, usage: Record<string, unknown> | null, modelKey: string, usageKey: string): number | null {
  return readNumber(modelUsage?.[modelKey]) ?? readNumber(usage?.[usageKey]);
}

function withDerivedRatios(detail: RuntimeUsageDetail): RuntimeUsageDetail {
  return {
    ...detail,
    context_usage_ratio: ratio(detail.input_tokens, detail.context_window),
    output_token_ratio: ratio(detail.output_tokens, detail.total_tokens),
  };
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

function sumKnown(...values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
