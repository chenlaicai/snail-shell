import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMcpHandler } from "../src/infra/mcp-server/handler";
import type { SnailMCPServerPort } from "../src/domain/snail-mcp-server/port";

/** Mock logger */
vi.mock("../src/infra/logger", () => ({
  getLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("mcp-handler 404 diagnostics", () => {
  let mockPort: SnailMCPServerPort;

  beforeEach(() => {
    mockPort = {
      registerServer: vi.fn(),
      listServers: vi.fn().mockReturnValue([
        { name: "server-a", version: "1.0.0", tools: [] },
        { name: "server-b", version: "1.0.0", tools: [] },
      ]),
      findServer: vi.fn().mockReturnValue(null),
      handleRequest: vi.fn(),
    };
  });

  /** 精确路由 404：GET /:serverName 不存在时返回诊断日志 */
  it("logs diagnostic info when server not found via exact route", async () => {
    const app = createMcpHandler(mockPort);
    const res = await app.request("/non-existent");

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: "Server not found" });
  });

  /** 全局 404：未匹配路径返回诊断日志 */
  it("logs diagnostic info for unmatched paths", async () => {
    const app = createMcpHandler(mockPort);
    const res = await app.request("/some/random/path");

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Not Found");
  });

  /** 列出所有 MCP Server */
  it("lists all MCP servers", async () => {
    const app = createMcpHandler(mockPort);
    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json() as { servers: Array<{ name: string }> };
    expect(body.servers).toHaveLength(2);
    expect(body.servers[0].name).toBe("server-a");
    expect(body.servers[1].name).toBe("server-b");
  });

  /** 获取存在的 MCP Server 信息 */
  it("returns server info for existing server", async () => {
    const mockServer = {
      name: "server-a",
      version: "1.0.0",
      tools: [{ name: "tool1", description: "desc", inputSchema: {} }],
    };
    (mockPort.findServer as ReturnType<typeof vi.fn>).mockReturnValue(mockServer);

    const app = createMcpHandler(mockPort);
    const res = await app.request("/server-a");

    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; tools: Array<{ name: string }> };
    expect(body.name).toBe("server-a");
    expect(body.tools).toHaveLength(1);
  });
});
