// src/web/services/api-client.ts — 类型安全 API client
import type { ApiEndpoints } from "../../api-contracts";

type EndpointKey = keyof ApiEndpoints;

/** 替换路径参数 :param → value */
function resolvePath(path: string, params?: Record<string, unknown>): string {
  if (!params) return path;
  let resolved = path;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

/** 拼接 query string */
function appendQuery(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) qs.set(key, String(value));
  }
  const qsStr = qs.toString();
  return qsStr ? `${path}?${qsStr}` : path;
}

/** 构建 fetch options */
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
  const path = appendQuery(
    resolvePath(rawPath, options?.params as Record<string, unknown>),
    options?.query as Record<string, unknown>
  );
  const response = await fetch(path, buildFetchOptions(method, options?.body));
  if (response.status === 204) return undefined!;
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
}
