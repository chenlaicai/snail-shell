import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../services/api-client";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("api-client (typed)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sends GET request with correct URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ id: "1", name: "test" }]),
    });
    const result = await api("GET /api/workspaces");
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces", { method: "GET" });
    expect(result).toEqual([{ id: "1", name: "test" }]);
  });

  it("replaces path params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "abc", name: "test" }),
    });
    await api("GET /api/workspaces/:workspaceId", { params: { workspaceId: "abc" } });
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/abc", { method: "GET" });
  });

  it("appends query string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });
    await api("GET /api/workspaces", { query: { limit: 10, offset: 0 } });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces?limit=10&offset=0",
      { method: "GET" }
    );
  });

  it("sends POST request with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ workspace: { id: "1" } }),
    });
    await api("POST /api/workspaces", { body: { name: "test", sop_id: "sop1" } });
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", sop_id: "sop1" }),
    });
  });

  it("returns undefined for 204 responses", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const result = await api("DELETE /api/workspaces/:workspaceId/sops/:sopId", {
      params: { workspaceId: "ws1", sopId: "sop1" },
    });
    expect(result).toBeUndefined();
  });

  it("throws error for non-ok responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });
    await expect(
      api("GET /api/issues/:issueId", { params: { issueId: "999" } })
    ).rejects.toThrow("Not found");
  });

  it("throws generic error when no error message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    await expect(
      api("GET /api/issues/:issueId", { params: { issueId: "1" } })
    ).rejects.toThrow("Request failed");
  });
});
