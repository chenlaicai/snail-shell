import { summarizeRuntimeError } from "../../src/agent/runtime-error";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const provider503 = "API Error: 503 {\"error\":{\"message\":\"Service temporarily unavailable\",\"type\":\"api_error\",\"code\":\"provider_response_error\"}}\n    at foo";
assert(summarizeRuntimeError(provider503) === "模型服务暂时不可用，请稍后重试。", "provider 503 errors should be summarized for users");

const upstreamAuth = "OpenAI request failed (502): {\"error\":{\"message\":\"Upstream authentication failed, please contact administrator\",\"type\":\"upstream_error\"}}";
assert(summarizeRuntimeError(upstreamAuth) === "模型服务上游认证失败，请联系管理员检查供应商配置。", "upstream authentication failures should point users to provider configuration");

const rateLimit = "API Error: 429 Too Many Requests";
assert(summarizeRuntimeError(rateLimit) === "模型服务当前繁忙，请稍后重试。", "rate limit errors should be summarized for users");

const permission = "PermissionError: [Errno 13] Permission denied";
assert(summarizeRuntimeError(permission) === "系统执行代理命令时遇到权限问题，请联系管理员处理。", "permission errors should be summarized for users");

console.log("runtime-error tests passed");
