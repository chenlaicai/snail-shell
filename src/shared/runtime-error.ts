export function summarizeRuntimeError(errorText: string): string {
  const trimmed = errorText.trim();
  if (!trimmed) {
    return "运行时发生异常，请稍后重试。";
  }

  const classified = classifyRuntimeError(errorText);
  if (classified) {
    return classified;
  }

  const firstLine = trimmed.split("\n")[0]?.trim();
  if (!firstLine) {
    return "运行时发生异常，请稍后重试。";
  }
  if (firstLine.length <= 120) {
    return firstLine;
  }
  return `${firstLine.slice(0, 117)}...`;
}

export function classifyRuntimeError(errorText: string): string | null {
  const lowered = errorText.toLowerCase();
  if (isServiceUnavailableError(lowered)) {
    return "模型服务暂时不可用，请稍后重试。";
  }
  if (isUpstreamAuthenticationError(lowered)) {
    return "模型服务上游认证失败，请联系管理员检查供应商配置。";
  }
  if (isRateLimitError(lowered)) {
    return "模型服务当前繁忙，请稍后重试。";
  }
  if (lowered.includes("permission denied")) {
    return "系统执行代理命令时遇到权限问题，请联系管理员处理。";
  }
  if (lowered.includes("timeout") || lowered.includes("timed out")) {
    return "代理响应超时，请稍后重试。";
  }
  return null;
}

function isServiceUnavailableError(lowered: string): boolean {
  return lowered.includes("service temporarily unavailable")
    || lowered.includes("provider_response_error")
    || lowered.includes("api error: 503")
    || lowered.includes("error_status\":503")
    || lowered.includes("error_status:503");
}

function isUpstreamAuthenticationError(lowered: string): boolean {
  return lowered.includes("upstream authentication failed")
    || lowered.includes("openai request failed (502)")
    || (lowered.includes("upstream_error") && lowered.includes("authentication"));
}

function isRateLimitError(lowered: string): boolean {
  return lowered.includes("api error: 429")
    || lowered.includes("rate limit")
    || lowered.includes("too many requests");
}
