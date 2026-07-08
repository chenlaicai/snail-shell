import { describe, it, expect } from "vitest";
import { checkSystemGate } from "@app/issue-collaboration/gate-check";

describe("checkSystemGate", () => {
  describe("rev-03", () => {
    it("returns false when review_comment_url is absent", () => {
      expect(checkSystemGate("rev-03", {})).toBe(false);
    });

    it("returns false when review_comment_url is empty string", () => {
      expect(checkSystemGate("rev-03", { review_comment_url: "" })).toBe(false);
    });

    it("returns false when review_comment_url is whitespace only", () => {
      expect(checkSystemGate("rev-03", { review_comment_url: "   " })).toBe(false);
    });

    it("returns true when review_comment_url exists", () => {
      expect(checkSystemGate("rev-03", { review_comment_url: "https://github.com/owner/repo/pull/1#issuecomment-123" })).toBe(true);
    });

    it("returns true when review_comment_url exists via suffixed key", () => {
      expect(checkSystemGate("rev-03", { "review.review_comment_url": "https://github.com/owner/repo/pull/1#issuecomment-456" })).toBe(true);
    });
  });

  describe("rev-01 and rev-02 remain prompt-level (always true)", () => {
    it("rev-01 returns true regardless of context", () => {
      expect(checkSystemGate("rev-01", {})).toBe(true);
    });

    it("rev-02 returns true regardless of context", () => {
      expect(checkSystemGate("rev-02", {})).toBe(true);
    });
  });
});
