const API = "/api";

export async function api(method: string, path: string, body?: unknown) {
  const options: RequestInit = { method, headers: {} as Record<string, string> };
  if (body) {
    (options.headers as Record<string, string>)["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(API + path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Request failed");
  }
  return data;
}
