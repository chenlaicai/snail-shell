import type { ApiEndpoints } from "@api-contracts";
import type { z } from "zod";
import { recordApiTiming } from "../lib/perf-logger";

type EndpointKey = Extract<keyof ApiEndpoints, string>;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function resolvePath(path: string, params?: unknown): string {
  if (!params || typeof params !== "object") return path;
  let resolved = path;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    resolved = resolved.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

function appendQuery(path: string, query?: unknown): string {
  if (!query || typeof query !== "object") return path;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value != null) qs.set(key, String(value));
  }
  const qsStr = qs.toString();
  return qsStr ? `${path}?${qsStr}` : path;
}

async function handleResponse<R>(response: Response, schema?: z.ZodType<R>): Promise<R> {
  if (response.status === 204) return undefined as R;
  const data = await response.json();
  if (!response.ok) throw new ApiError(data?.error || data?.message || "Request failed", response.status);
  return schema ? schema.parse(data) : data;
}

function buildFetchOptions(method: string, body?: unknown): RequestInit {
  if (!body) return { method };
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function api<K extends EndpointKey>(
  endpoint: K,
  options?: {
    params?: ApiEndpoints[K]["params"] extends never ? never : ApiEndpoints[K]["params"];
    query?: ApiEndpoints[K]["query"] extends never ? never : ApiEndpoints[K]["query"];
    body?: ApiEndpoints[K]["body"] extends never ? never : ApiEndpoints[K]["body"];
    schema?: z.ZodType<ApiEndpoints[K]["response"]>;
  },
): Promise<ApiEndpoints[K]["response"]> {
  const spaceIdx = endpoint.indexOf(" ");
  if (spaceIdx === -1) throw new Error(`Invalid endpoint format: ${endpoint}`);
  const method = endpoint.slice(0, spaceIdx);
  const path = appendQuery(resolvePath(endpoint.slice(spaceIdx + 1), options?.params), options?.query);
  const start = performance.now();
  const response = await fetch(path, buildFetchOptions(method, options?.body));
  recordApiTiming(method, path, performance.now() - start);
  return handleResponse(response, options?.schema);
}
