import { describe, it, expect, vi, beforeEach } from "vitest";
import { encodeWorkspaceId, decodeWorkspaceId } from "@infra/http/workspace-id";
import type { CollaborationInput } from "@app/issue-collaboration/port";

// Capture the callback passed to upgradeWebSocket before module loads
let capturedHandler: ((c: { req: { url: string } }) => Record<string, unknown>) | null = null;

vi.mock("@hono/node-server", () => ({
  upgradeWebSocket: (handler: (c: { req: { url: string } }) => Record<string, unknown>) => {
    capturedHandler = handler;
    // Return a no-op middleware
    return (_c: unknown, next: () => Promise<void>) => next();
  },
}));

vi.mock("@infra/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createUnifiedWebSocketBridge } from "@infra/http/unified-websocket";

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

function createMockCollaboration() {
  const calls: { method: string; args: unknown[] }[] = [];
  const proxy = new Proxy({} as CollaborationInput, {
    get(_target, prop: string) {
      if (prop === "calls") return calls;
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return undefined;
      };
    },
  });
  return { collaboration: proxy, calls };
}

function createMockSocket() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  };
}

describe("handler-layer: workspace consumer registration with base64url decoding", () => {
  beforeEach(() => {
    capturedHandler = null;
    vi.clearAllMocks();
  });

  it("registerWorkspaceConsumer receives decoded path (not base64url encoded)", () => {
    const { collaboration, calls } = createMockCollaboration();
    createUnifiedWebSocketBridge(collaboration);
    const handler = capturedHandler!;

    const rawPath = "/Users/orca/ai/snail-shell";
    const encodedId = encodeWorkspaceId(rawPath);
    const socket = createMockSocket();

    const routeHandler = handler({
      req: { url: `http://localhost/workspace-events?workspace_id=${encodedId}` },
    }) as { onOpen: (event: unknown, socket: unknown) => void };

    routeHandler.onOpen({}, socket);

    const registerCall = calls.find(c => c.method === "registerWorkspaceConsumer");
    expect(registerCall).toBeDefined();
    expect(registerCall!.args[0]).toBe(rawPath);
  });

  it("unregisterWorkspaceConsumer receives decoded path on cleanup", () => {
    const { collaboration, calls } = createMockCollaboration();
    createUnifiedWebSocketBridge(collaboration);
    const handler = capturedHandler!;

    const rawPath = "/Users/orca/ai/snail-shell";
    const encodedId = encodeWorkspaceId(rawPath);
    const socket = createMockSocket();

    const routeHandler = handler({
      req: { url: `http://localhost/workspace-events?workspace_id=${encodedId}` },
    }) as { onOpen: (event: unknown, socket: unknown) => void; onClose: () => void };

    routeHandler.onOpen({}, socket);
    routeHandler.onClose();

    const unregisterCall = calls.find(c => c.method === "unregisterWorkspaceConsumer");
    expect(unregisterCall).toBeDefined();
    expect(unregisterCall!.args[0]).toBe(rawPath);
  });

  it("both register and unregister use the same decoded path for special-char workspace paths", () => {
    const { collaboration, calls } = createMockCollaboration();
    createUnifiedWebSocketBridge(collaboration);
    const handler = capturedHandler!;

    const rawPath = "/Users/some-user/projects/my project (v2)";
    const encodedId = encodeWorkspaceId(rawPath);
    const socket = createMockSocket();

    const routeHandler = handler({
      req: { url: `http://localhost/workspace-events?workspace_id=${encodedId}` },
    }) as { onOpen: (event: unknown, socket: unknown) => void; onClose: () => void };

    routeHandler.onOpen({}, socket);
    routeHandler.onClose();

    const registerCall = calls.find(c => c.method === "registerWorkspaceConsumer");
    const unregisterCall = calls.find(c => c.method === "unregisterWorkspaceConsumer");
    expect(registerCall!.args[0]).toBe(rawPath);
    expect(unregisterCall!.args[0]).toBe(rawPath);
  });
});
