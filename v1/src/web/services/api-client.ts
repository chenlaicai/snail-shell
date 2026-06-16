// src/web/services/api client — 类型安全 API client
import type { ApiEndpoints } from "../../api-contracts";
import type { z } from "zod";

type EndpointKey = keyof ApiEndpoints;

/** API 错误，携带 HTTP status code 供全局错误处理区分 404 等业务状态 */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** 替换路径参数 :param → value */
function resolvePath(path: string, params?: unknown): string {
  if (!params || typeof params !== "object") return path;
  let resolved = path;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    resolved = resolved.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

/** 拼接 query string */
function appendQuery(path: string, query?: unknown): string {
  if (!query || typeof query !== "object") return path;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value != null) qs.set(key, String(value));
  }
  const qsStr = qs.toString();
  return qsStr ? `${path}?${qsStr}` : path;
}

/** 处理 fetch 响应：状态检查 + JSON 解析 + 可选 zod 校验 */
async function handleResponse<R>(
  response: Response,
  schema?: z.ZodType<R>,
): Promise<R> {
  if (response.status === 204) return undefined as R;
  const data = await response.json();
  if (!response.ok) throw new ApiError(data?.error || data?.message || "Request failed", response.status);
  return schema ? schema.parse(data) : data;
}

/** 构建 fetch options。认证：Snail Shell 为本地运行工具，无 Authorization header。 */
function buildFetchOptions(method: string, body?: unknown): RequestInit {
  if (!body) return { method };
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// 类型安全的 API 调用函数
// 可选 schema 参数：传入 zod schema 时对响应做运行时校验，不传则只做编译期类型检查
export async function api<K extends EndpointKey>(
  endpoint: K,
  options?: {
    params?: ApiEndpoints[K]["params"] extends never ? never : ApiEndpoints[K]["params"];
    query?: ApiEndpoints[K]["query"] extends never ? never : ApiEndpoints[K]["query"];
    body?: ApiEndpoints[K]["body"] extends never ? never : ApiEndpoints[K]["body"];
    schema?: z.ZodType<ApiEndpoints[K]["response"]>;
  }
): Promise<ApiEndpoints[K]["response"]> {
  const spaceIdx = endpoint.indexOf(" ");
  if (spaceIdx === -1) throw new Error(`Invalid endpoint format: ${endpoint}`);
  const method = endpoint.slice(0, spaceIdx);
  const path = appendQuery(resolvePath(endpoint.slice(spaceIdx + 1), options?.params), options?.query);
  const response = await fetch(path, buildFetchOptions(method, options?.body));
  return handleResponse(response, options?.schema);
}
