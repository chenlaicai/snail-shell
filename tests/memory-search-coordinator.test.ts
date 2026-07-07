import { describe, it, expect, vi } from "vitest";
import { SearchCoordinator, buildFtsMatchQuery } from "@domain/memory-search/_internal/coordinator";
import type { SearchChannel } from "@domain/memory-search/port";
import type { ChannelResult } from "@domain/memory-search/model";

function makeChannel(
  domain: string,
  content_type: ChannelResult["content_type"],
  results: ChannelResult[],
  shouldThrow = false,
): SearchChannel {
  return {
    domain,
    content_type,
    search: vi.fn(() => {
      if (shouldThrow) throw new Error("Channel failed");
      return results;
    }),
    rebuild: vi.fn(),
    validate: vi.fn(() => true),
  };
}

describe("SearchCoordinator", () => {
  describe("cross-domain search (B1)", () => {
    it("queries all registered channels and returns fused results", () => {
      const coordinator = new SearchCoordinator();
      coordinator.registerChannel(makeChannel("knowledge", "knowledge", [
        { content_type: "knowledge", id: "k1", title: "K1", snippet: "s", raw_score: 10, source: { domain: "knowledge" }, metadata: {} },
      ]));
      coordinator.registerChannel(makeChannel("message", "message", [
        { content_type: "message", id: "m1", title: "M1", snippet: "s", raw_score: 5, source: { domain: "message" }, metadata: {} },
      ]));

      const results = coordinator.search("test", {});
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id)).toContain("k1");
      expect(results.map((r) => r.id)).toContain("m1");
    });
  });

  describe("domain filtering (B2)", () => {
    it("only queries specified content_types", () => {
      const knowledgeChannel = makeChannel("knowledge", "knowledge", [
        { content_type: "knowledge", id: "k1", title: "K1", snippet: "s", raw_score: 10, source: { domain: "knowledge" }, metadata: {} },
      ]);
      const messageChannel = makeChannel("message", "message", [
        { content_type: "message", id: "m1", title: "M1", snippet: "s", raw_score: 5, source: { domain: "message" }, metadata: {} },
      ]);

      const coordinator = new SearchCoordinator();
      coordinator.registerChannel(knowledgeChannel);
      coordinator.registerChannel(messageChannel);

      const results = coordinator.search("test", { content_types: ["knowledge"] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("k1");
      expect(knowledgeChannel.search).toHaveBeenCalledOnce();
      expect(messageChannel.search).not.toHaveBeenCalled();
    });
  });

  describe("partial degradation (B13)", () => {
    it("skips failed channels and returns results from successful ones", () => {
      const coordinator = new SearchCoordinator();
      coordinator.registerChannel(makeChannel("knowledge", "knowledge", [
        { content_type: "knowledge", id: "k1", title: "K1", snippet: "s", raw_score: 10, source: { domain: "knowledge" }, metadata: {} },
      ], true)); // this channel throws
      coordinator.registerChannel(makeChannel("message", "message", [
        { content_type: "message", id: "m1", title: "M1", snippet: "s", raw_score: 5, source: { domain: "message" }, metadata: {} },
      ]));

      const results = coordinator.search("test", {});
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("m1");
    });

    it("returns empty array when all channels fail", () => {
      const coordinator = new SearchCoordinator();
      coordinator.registerChannel(makeChannel("knowledge", "knowledge", [], true));
      coordinator.registerChannel(makeChannel("message", "message", [], true));

      const results = coordinator.search("test", {});
      expect(results).toHaveLength(0);
    });
  });

  describe("top_n", () => {
    it("respects top_n option (default 20)", () => {
      const results = Array.from({ length: 30 }, (_, i) => ({
        content_type: "knowledge" as const,
        id: `k${i}`,
        title: `K${i}`,
        snippet: "s",
        raw_score: 30 - i,
        source: { domain: "knowledge" },
        metadata: {},
      }));

      const coordinator = new SearchCoordinator();
      coordinator.registerChannel(makeChannel("knowledge", "knowledge", results));

      const defaultResults = coordinator.search("test", {});
      expect(defaultResults).toHaveLength(20);

      const limitedResults = coordinator.search("test", { top_n: 5 });
      expect(limitedResults).toHaveLength(5);
    });
  });
});

describe("buildFtsMatchQuery", () => {
  it("returns MATCH query for >=3 Unicode characters", () => {
    expect(buildFtsMatchQuery("记忆系统")).toBe('"记忆系统"');
    expect(buildFtsMatchQuery("abc")).toBe('"abc"');
  });

  it("returns null for <3 Unicode characters (B5 short query fallback)", () => {
    expect(buildFtsMatchQuery("记")).toBeNull();
    expect(buildFtsMatchQuery("ab")).toBeNull();
    expect(buildFtsMatchQuery("")).toBeNull();
    expect(buildFtsMatchQuery("  ")).toBeNull();
  });

  it("handles multi-term queries", () => {
    expect(buildFtsMatchQuery("记忆 系统")).toBe('"记忆" AND "系统"');
  });

  it("escapes double quotes in terms", () => {
    expect(buildFtsMatchQuery('te"st')).toBe('"te""st"');
  });
});
