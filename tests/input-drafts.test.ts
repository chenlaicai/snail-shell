import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveDraft, getDraft, removeDraft } from "../src/web/lib/input-drafts";

/** Mock localStorage */
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("input-drafts", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  /** S1 — 缓存写入：saveDraft 后 getDraft 能读到 */
  it("saves and retrieves draft by issueId", () => {
    saveDraft("issue-1", "Hello world");
    expect(getDraft("issue-1")).toBe("Hello world");
  });

  /** S2 — 按 Issue 隔离：不同 issueId 的草稿互不干扰 */
  it("isolates drafts by issueId", () => {
    saveDraft("issue-1", "Draft A");
    saveDraft("issue-2", "Draft B");
    expect(getDraft("issue-1")).toBe("Draft A");
    expect(getDraft("issue-2")).toBe("Draft B");
  });

  /** S4 — 发送清理：removeDraft 后 getDraft 返回 null */
  it("removes draft after send", () => {
    saveDraft("issue-1", "Hello");
    removeDraft("issue-1");
    expect(getDraft("issue-1")).toBeNull();
  });

  /** S5 — 空内容不缓存：getDraft 对不存在的 issueId 返回 null */
  it("returns null for non-existent issueId", () => {
    expect(getDraft("non-existent")).toBeNull();
  });

  /** 边界场景：localStorage 不可用时静默降级 */
  it("silently fails when localStorage throws", () => {
    localStorageMock.setItem.mockImplementation(() => { throw new Error("QuotaExceededError"); });
    // saveDraft 不应抛出异常
    expect(() => saveDraft("issue-1", "test")).not.toThrow();
    localStorageMock.setItem.mockReset();
  });

  /** 边界场景：覆盖写入（最后一次写入生效） */
  it("overwrites existing draft on save", () => {
    saveDraft("issue-1", "Version 1");
    saveDraft("issue-1", "Version 2");
    expect(getDraft("issue-1")).toBe("Version 2");
  });

  /** 边界场景：removeDraft 对不存在的 issueId 不抛异常 */
  it("does not throw when removing non-existent draft", () => {
    expect(() => removeDraft("non-existent")).not.toThrow();
  });
});
