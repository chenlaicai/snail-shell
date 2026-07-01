import { describe, it, expect } from "vitest";
import { extractMentionQuery } from "../src/web/hooks/useMention";

describe("extractMentionQuery", () => {
  /** 基本场景：正在输入 mention */
  it("returns query when typing @ali", () => {
    expect(extractMentionQuery("@ali", 4)).toEqual({ start: 0, query: "ali" });
  });

  /** @ 后无字符时显示全量列表 */
  it("returns empty query when cursor right after @ with no query", () => {
    expect(extractMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  /** 空格后 @ 后无字符时也显示全量列表 */
  it("returns empty query when cursor right after @ with space prefix", () => {
    expect(extractMentionQuery(" @", 2)).toEqual({ start: 1, query: "" });
  });

  /** 核心修复：选中 mention 后 trailing space 不触发候选框 */
  it("returns null for completed mention with trailing space", () => {
    expect(extractMentionQuery("@alice ", 7)).toBeNull();
  });

  /** 光标在 mention 中间时不触发候选框 */
  it("returns null when cursor is mid-word", () => {
    expect(extractMentionQuery("@alice", 4)).toBeNull();
  });

  /** 完整 mention 无 trailing space，cursor 在末尾 → 还在输入中 */
  it("returns query when cursor at end of exact match without trailing space", () => {
    expect(extractMentionQuery("@alice", 6)).toEqual({ start: 0, query: "alice" });
  });

  /** 完成 mention 后继续输入新内容，中间有空格 */
  it("returns null when cursor is after completed mention with more text", () => {
    expect(extractMentionQuery("@alice hello", 12)).toBeNull();
  });

  /** email 地址不应触发 mention */
  it("returns null for email-like text", () => {
    expect(extractMentionQuery("user@domain.com", 15)).toBeNull();
  });

  /** 空格后 @mention 应正常工作 */
  it("works after space", () => {
    expect(extractMentionQuery("hello @bob", 10)).toEqual({ start: 6, query: "bob" });
  });

  /** @ 前有非空白字符时不应触发 */
  it("returns null when @ preceded by non-whitespace", () => {
    expect(extractMentionQuery("test@foo", 8)).toBeNull();
  });

  /** Unicode mention：光标在字符中间 */
  it("returns null when cursor mid-unicode-word", () => {
    expect(extractMentionQuery("@开发者", 2)).toBeNull();
  });

  /** Unicode mention：完整匹配无 trailing space */
  it("returns query for complete unicode match without trailing space", () => {
    expect(extractMentionQuery("@开发者", 4)).toEqual({ start: 0, query: "开发者" });
  });

  /** Unicode mention：完成后 trailing space */
  it("returns null for completed unicode mention with trailing space", () => {
    expect(extractMentionQuery("@开发者 ", 5)).toBeNull();
  });

  /** @ 后紧跟空白不触发 */
  it("returns null when @ followed by space", () => {
    expect(extractMentionQuery("@ hello", 2)).toBeNull();
  });

  /** mention 后跟标点时仍触发（标点是单词边界） */
  it("returns query when followed by punctuation", () => {
    expect(extractMentionQuery("@alice!", 6)).toEqual({ start: 0, query: "alice" });
  });

  /** 连字符 mention：光标在连字符前时视为中间位置，不触发候选框 */
  it("returns null when cursor before hyphen in mention", () => {
    expect(extractMentionQuery("@alice-bob", 6)).toBeNull();
  });

  /** 连字符 mention：光标在末尾时正常触发 */
  it("returns query for hyphenated mention at end", () => {
    expect(extractMentionQuery("@alice-bob", 10)).toEqual({ start: 0, query: "alice-bob" });
  });
});
