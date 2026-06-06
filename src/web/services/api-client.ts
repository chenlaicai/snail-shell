// src/web/services/api-client.ts — 类型安全 API client
import type { ApiEndpoints } from "../../api-contracts";

type EndpointKey = keyof ApiEndpoints;

/** 类型守卫：检查值是否为非 null 对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 替换路径参数 :param → value */
function resolvePath(path: string, params?: unknown): string {
  if (!isRecord(params)) return path;
  let resolved = path;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

/** 拼接 query string */
function appendQuery(path: string, query?: unknown): string {
  if (!isRecord(query)) return path;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) qs.set(key, String(value));
  }
  const qsStr = qs.toString();
  return qsStr ? `${path}?${qsStr}` : path;
}

/** 构建 fetch options。认证：Snail Shell 为本地运行工具，无 Authorization header。 */
function buildFetchOptions(method: string, body?: unknown): RequestInit {
  if (!body) return { method };
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** 解析 endpoint 字符串为 method + path */
function parseEndpoint(endpoint: string): [string, string] {
  const spaceIdx = endpoint.indexOf(" ");
  if (spaceIdx === -1) throw new Error(`Invalid endpoint format: ${endpoint}`);
  return [endpoint.slice(0, spaceIdx), endpoint.slice(spaceIdx + 1)];
}

// 类型安全的 API 调用函数
export async function api<K extends EndpointKey>(
  endpoint: K,
  options?: {
    params?: ApiEndpoints[K]["params"] extends never ? never : ApiEndpoints[K]["params"];
    query?: ApiEndpoints[K]["query"] extends never ? never : ApiEndpoints[K]["query"];
    body?: ApiEndpoints[K]["body"] extends never ? never : ApiEndpoints[K]["body"];
  }
): Promise<ApiEndpoints[K]["response"]> {
  const [method, rawPath] = parseEndpoint(endpoint);
  const path = appendQuery(resolvePath(rawPath, options?.params), options?.query);
  const response = await fetch(path, buildFetchOptions(method, options?.body));
  // 204 No Content — DELETE 等 endpoint 无响应体。
  // ! 非空断言：TypeScript 泛型约束下 TResponse=undefined 时 return undefined 无法通过类型检查，
  // 但运行时值确实是 undefined，语义正确。此为 api-client.ts 内部唯一的 ! 断言。
  if (response.status === 204) return undefined!;
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
}
