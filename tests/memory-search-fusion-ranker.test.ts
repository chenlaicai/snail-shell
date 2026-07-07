import { describe, it, expect } from "vitest";
import { fuseAndRank } from "@domain/memory-search/_internal/fusion-ranker";
import type { ChannelResult } from "@domain/memory-search/model";

function makeResult(
  content_type: ChannelResult["content_type"],
  id: string,
  raw_score: number,
  title = "test",
): ChannelResult {
  return {
    content_type,
    id,
    title,
    snippet: "snippet",
    raw_score,
    source: { domain: content_type },
    metadata: {},
  };
}

describe("fusion-ranker", () => {
  describe("max normalization", () => {
    it("normalizes scores within each domain to [0, 1]", () => {
      const results = [
        makeResult("knowledge", "k1", 10),
        makeResult("knowledge", "k2", 5),
        makeResult("message", "m1", 4),
      ];

      const ranked = fuseAndRank(results, 10);

      // knowledge: max=10, k1=1.0, k2=0.5
      // message: max=4, m1=1.0
      const k1 = ranked.find((r) => r.id === "k1")!;
      const k2 = ranked.find((r) => r.id === "k2")!;
      const m1 = ranked.find((r) => r.id === "m1")!;

      expect(k1.score).toBeCloseTo(1.0); // 10/10 * 1.0 (knowledge weight)
      expect(k2.score).toBeCloseTo(0.5); // 5/10 * 1.0
      expect(m1.score).toBeCloseTo(0.8); // 4/4 * 0.8 (message weight)
    });

    it("handles single result without division by zero", () => {
      const results = [makeResult("knowledge", "k1", 5)];
      const ranked = fuseAndRank(results, 10);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].score).toBeCloseTo(1.0);
    });

    it("handles zero max score", () => {
      const results = [makeResult("knowledge", "k1", 0)];
      const ranked = fuseAndRank(results, 10);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].score).toBe(0);
    });
  });

  describe("domain weights", () => {
    it("applies correct weights: knowledge=1.0, feature_doc=1.0, evolution=0.9, message=0.8", () => {
      const results = [
        makeResult("knowledge", "k1", 10),
        makeResult("feature_doc", "f1", 10),
        makeResult("evolution", "e1", 10),
        makeResult("message", "m1", 10),
      ];

      const ranked = fuseAndRank(results, 10);

      const k1 = ranked.find((r) => r.id === "k1")!;
      const f1 = ranked.find((r) => r.id === "f1")!;
      const e1 = ranked.find((r) => r.id === "e1")!;
      const m1 = ranked.find((r) => r.id === "m1")!;

      expect(k1.score).toBeCloseTo(1.0);
      expect(f1.score).toBeCloseTo(1.0);
      expect(e1.score).toBeCloseTo(0.9);
      expect(m1.score).toBeCloseTo(0.8);
    });
  });

  describe("conditional diversity rerank", () => {
    it("does NOT diversify when domain max scores differ >20%", () => {
      // knowledge max=1.0, message max=0.4 → diff = 60% → no diversity
      const results = [
        makeResult("knowledge", "k1", 10),
        makeResult("knowledge", "k2", 9),
        makeResult("knowledge", "k3", 8),
        makeResult("message", "m1", 4),
        makeResult("message", "m2", 3),
      ];

      const ranked = fuseAndRank(results, 3);

      // No diversity → top 3 by score: k1(1.0), k2(0.9), k3(0.8)
      expect(ranked.map((r) => r.id)).toEqual(["k1", "k2", "k3"]);
    });

    it("diversifies when domain max scores differ <20%", () => {
      // Use knowledge vs feature_doc (both weight 1.0) to trigger diversity:
      // After normalization: k1=1.0, k2=0.9, k3=0.8
      // f1=1.0, f2=10/11≈0.909
      // domain max: knowledge=1.0, feature_doc=1.0 → diff=0% < 20% → diversity!
      // top_n=4, active_domains=2, per_domain_limit = ceil(4/2 * 1.5) = 3
      // Sorted: k1(1.0), f1(1.0), f2(0.909), k2(0.9), k3(0.8)
      // With diversity (limit 3 per domain): k1, f1, f2, k2 → top 4
      const results = [
        makeResult("knowledge", "k1", 10),
        makeResult("knowledge", "k2", 9),
        makeResult("knowledge", "k3", 8),
        makeResult("feature_doc", "f1", 11),
        makeResult("feature_doc", "f2", 10),
      ];

      const ranked = fuseAndRank(results, 4);
      expect(ranked.map((r) => r.id)).toContain("f1");
      expect(ranked.map((r) => r.id)).toContain("f2");
      expect(ranked.map((r) => r.id)).toContain("k1");
      expect(ranked.map((r) => r.id)).toContain("k2");
    });

    it("respects per-domain limit during diversity rerank", () => {
      // knowledge vs feature_doc, both weight 1.0 → diff=0% → diversity
      // top_n=2, active_domains=2, per_domain_limit = ceil(2/2 * 1.5) = 2
      const results = [
        makeResult("knowledge", "k1", 10),
        makeResult("knowledge", "k2", 9),
        makeResult("feature_doc", "f1", 9.5),
      ];

      const ranked = fuseAndRank(results, 2);
      // Sorted: k1(1.0), f1(0.95), k2(0.9)
      // per_domain_limit=2, so all pass → top 2: k1, f1
      expect(ranked.map((r) => r.id)).toEqual(["k1", "f1"]);
    });
  });

  describe("top N", () => {
    it("returns at most top_n results", () => {
      const results = Array.from({ length: 10 }, (_, i) =>
        makeResult("knowledge", `k${i}`, 10 - i),
      );

      const ranked = fuseAndRank(results, 3);
      expect(ranked).toHaveLength(3);
    });

    it("returns all results if fewer than top_n", () => {
      const results = [makeResult("knowledge", "k1", 1)];
      const ranked = fuseAndRank(results, 10);
      expect(ranked).toHaveLength(1);
    });

    it("returns empty array for no results", () => {
      const ranked = fuseAndRank([], 10);
      expect(ranked).toHaveLength(0);
    });
  });

  describe("unified result format", () => {
    it("preserves source and metadata from channel results", () => {
      const results: ChannelResult[] = [{
        content_type: "knowledge",
        id: "k1",
        title: "Test Title",
        snippet: "Test Snippet",
        raw_score: 5,
        source: { domain: "knowledge", file_path: "/path/to/file" },
        metadata: { tags: ["search"], scope: "platform", created_at: "2026-01-01" },
      }];

      const ranked = fuseAndRank(results, 10);
      expect(ranked[0].content_type).toBe("knowledge");
      expect(ranked[0].id).toBe("k1");
      expect(ranked[0].title).toBe("Test Title");
      expect(ranked[0].snippet).toBe("Test Snippet");
      expect(ranked[0].source.file_path).toBe("/path/to/file");
      expect(ranked[0].metadata.tags).toEqual(["search"]);
      expect(ranked[0].metadata.scope).toBe("platform");
    });
  });
});
