// src/web/services/api-client.ts — 类型安全 API client
// 替换现有的无类型 api.ts
import type { ApiEndpoints } from "../../api-contracts";

type EndpointKey = keyof ApiEndpoints;

// 类型安全的 API 调用函数
export async function api<K extends EndpointKey>(
  endpoint: K,
  options?: {
    params?: ApiEndpoints[K]["params"] extends never ? never : ApiEndpoints[K]["params"];
    query?: ApiEndpoints[K]["query"] extends never ? never : ApiEndpoints[K]["query"];
    body?: ApiEndpoints[K]["body"] extends never ? never : ApiEndpoints[K]["body"];
  }
): Promise<ApiEndpoints[K]["response"]> {
  // 运行时拆分 method 和 path
  const spaceIdx = endpoint.indexOf(" ");
  if (spaceIdx === -1) throw new Error(`Invalid endpoint format: ${endpoint}`);
  const method = endpoint.slice(0, spaceIdx);
  let path = endpoint.slice(spaceIdx + 1);

  // 替换路径参数
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      path = path.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  }

  // 拼接 query string
  if (options?.query) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) qs.set(key, String(value));
    }
    const qsStr = qs.toString();
    if (qsStr) path += `?${qsStr}`;
  }

  const fetchOptions: RequestInit = { method };
  if (options?.body) {
    fetchOptions.headers = { "Content-Type": "application/json" };
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, fetchOptions);
  // 204 无 body，直接返回。DELETE 等 endpoint 的 TResponse 为 undefined，类型匹配。
  if (response.status === 204) return undefined!;
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
}
