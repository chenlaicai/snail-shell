import { describe, it, expect } from "vitest";
import { encodeWorkspaceId, decodeWorkspaceId } from "@infra/http/workspace-id";

describe("workspace-id encoding/decoding", () => {
  it("roundtrips workspace path through base64url", () => {
    const path = "/Users/orca/ai/snail-shell";
    const encoded = encodeWorkspaceId(path);
    const decoded = decodeWorkspaceId(encoded);
    expect(decoded).toBe(path);
  });

  it("produces different encoded vs original value", () => {
    const path = "/Users/orca/ai/snail-shell";
    const encoded = encodeWorkspaceId(path);
    expect(encoded).not.toBe(path);
  });

  it("decodeWorkspaceId reverses encodeWorkspaceId for paths with special chars", () => {
    const path = "/Users/some-user/projects/my project (v2)";
    const encoded = encodeWorkspaceId(path);
    expect(decodeWorkspaceId(encoded)).toBe(path);
  });
});
