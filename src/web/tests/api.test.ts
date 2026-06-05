import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../services/api";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("api service", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sends GET request with correct URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "1", name: "test" }),
    });
    const result = await api("GET", "/workspaces");
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces", { method: "GET", headers: {} });
    expect(result).toEqual({ id: "1", name: "test" });
  });

  it("sends POST request with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });
    await api("POST", "/workspaces", { name: "test" });
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
  });

  it("returns null for 204 responses", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
    const result = await api("DELETE", "/workspaces/1");
    expect(result).toBeNull();
  });

  it("throws error for non-ok responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });
    await expect(api("GET", "/workspaces/999")).rejects.toThrow("Not found");
  });

  it("throws generic error when no error message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    await expect(api("GET", "/fail")).rejects.toThrow("Request failed");
  });
});
