import { describe, it, expect, vi } from "vitest";
import type { EvolutionPort } from "@domain/evolution/port";
import type { EvolutionItem } from "@domain/evolution/model";

// Import via the server factory to test through the public API
import { createEvolutionServer } from "@domain/snail-mcp-server/_internal/servers/evolution";

function createMockEvolutionPort(): EvolutionPort {
  return {
    findById: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    create: vi.fn(
      (input) =>
        ({
          id: "evo-1",
          workspace_id: input.workspace_id,
          status: "candidate",
          issue_id: null,
          title: input.title,
          content: input.content,
          tags: input.tags ?? [],
          result: null,
          metadata: input.metadata ?? null,
          created_at: "2026-07-01T00:00:00Z",
          updated_at: "2026-07-01T00:00:00Z",
        }) as EvolutionItem,
    ),
    update: vi.fn(),
  };
}

function getCreateCandidateHandler(evolution: EvolutionPort) {
  const server = createEvolutionServer(evolution);
  const tool = server.tools.find((t) => t.name === "create_candidate")!;
  return tool.handler;
}

const BASE_PARAMS = {
  title: "Test",
  content: "Content",
  workspace_id: "ws-1",
};

const VALID_AUTO_GEN = {
  source_type: "auto" as const,
  trigger_reason: "user_dissatisfied" as const,
  related_message_id: 42,
  related_issue_id: "issue-1",
  related_stage_id: "stage-1",
};

describe("create_candidate validation", () => {
  it("accepts valid auto_generation metadata", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    const result = (await handler({ ...BASE_PARAMS, metadata: { auto_generation: VALID_AUTO_GEN } })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(port.create).toHaveBeenCalledOnce();
  });

  it("accepts undefined metadata (manual path)", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    const result = (await handler(BASE_PARAMS)) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("accepts null metadata (manual path)", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    const result = (await handler({ ...BASE_PARAMS, metadata: null })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("accepts metadata without auto_generation (manual path)", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    const result = (await handler({ ...BASE_PARAMS, metadata: { custom: "data" } })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("rejects non-object auto_generation", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    await expect(handler({ ...BASE_PARAMS, metadata: { auto_generation: "bad" } })).rejects.toThrow(
      "metadata.auto_generation must be an object",
    );
  });

  it("rejects invalid source_type", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    await expect(
      handler({
        ...BASE_PARAMS,
        metadata: { auto_generation: { ...VALID_AUTO_GEN, source_type: "manual" } },
      }),
    ).rejects.toThrow('metadata.auto_generation.source_type must be "auto"');
  });

  it("rejects invalid trigger_reason", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    await expect(
      handler({
        ...BASE_PARAMS,
        metadata: { auto_generation: { ...VALID_AUTO_GEN, trigger_reason: "invalid_reason" } },
      }),
    ).rejects.toThrow("metadata.auto_generation.trigger_reason must be one of:");
  });

  it("rejects non-number related_message_id", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    await expect(
      handler({
        ...BASE_PARAMS,
        metadata: { auto_generation: { ...VALID_AUTO_GEN, related_message_id: "42" } },
      }),
    ).rejects.toThrow("metadata.auto_generation.related_message_id must be a number");
  });

  it("rejects non-string related_issue_id", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    await expect(
      handler({
        ...BASE_PARAMS,
        metadata: { auto_generation: { ...VALID_AUTO_GEN, related_issue_id: 123 } },
      }),
    ).rejects.toThrow("metadata.auto_generation.related_issue_id must be a string");
  });

  it("rejects non-string related_stage_id", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);

    await expect(
      handler({
        ...BASE_PARAMS,
        metadata: { auto_generation: { ...VALID_AUTO_GEN, related_stage_id: 123 } },
      }),
    ).rejects.toThrow("metadata.auto_generation.related_stage_id must be a string");
  });

  it("accepts all valid trigger_reason values", async () => {
    const port = createMockEvolutionPort();
    const handler = getCreateCandidateHandler(port);
    const reasons = ["user_dissatisfied", "user_confused", "user_corrected", "repeat_problem", "feature_missing"];

    for (const reason of reasons) {
      vi.mocked(port.create).mockClear();
      const result = (await handler({
        ...BASE_PARAMS,
        metadata: { auto_generation: { ...VALID_AUTO_GEN, trigger_reason: reason } },
      })) as { ok: boolean };
      expect(result.ok).toBe(true);
    }
  });
});
