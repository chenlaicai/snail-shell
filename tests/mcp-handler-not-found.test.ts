import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMcpHandler } from "../src/adapter/mcp-server/handler";
import type { SnailMCPServerPort } from "../src/domain/snail-mcp-server/port";

/** Mock logger — 使用 vi.hoisted 确保在 vi.mock 之前可用 */
const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}));

vi.mock("../src/infra/logger", () => ({
  getLogger: () => ({
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("mcp-handler 404 diagnostics", () => {
  let mockPort: SnailMCPServerPort;

  beforeEach(() => {
    vi.clearAllMocks();
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

  /** GET 精确路由 404：server 不存在时记录诊断日志 */
  it("logs diagnostic info when GET server not found via exact route", async () => {
    const app = createMcpHandler(mockPort);
    const res = await app.request("/non-existent");

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: "Server not found" });

    // 验证诊断日志：log.warn 被调用，参数包含 path/method/registeredEndpoints
    expect(mockWarn).toHaveBeenCalledOnce();
    const [logData, logKey] = mockWarn.mock.calls[0];
    expect(logKey).toBe("mcp.endpoint.not_found");
    expect(logData).toMatchObject({
      path: "/non-existent",
      method: "GET",
      registeredEndpoints: ["server-a", "server-b"],
    });
  });

  /** POST 精确路由 404：server 不存在时记录诊断日志 */
  it("logs diagnostic info when POST server not found via exact route", async () => {
    const app = createMcpHandler(mockPort);
    const res = await app.request("/non-existent", { method: "POST", body: '{"jsonrpc":"2.0","method":"test","id":1}' });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toBe("Server not found");

    // 验证诊断日志
    expect(mockWarn).toHaveBeenCalledOnce();
    const [logData, logKey] = mockWarn.mock.calls[0];
    expect(logKey).toBe("mcp.endpoint.not_found");
    expect(logData).toMatchObject({
      path: "/non-existent",
      method: "POST",
      registeredEndpoints: ["server-a", "server-b"],
    });
  });

  /** 全局 404：未匹配路径记录诊断日志 */
  it("logs diagnostic info for unmatched paths", async () => {
    const app = createMcpHandler(mockPort);
    const res = await app.request("/some/random/path");

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Not Found");

    // 验证诊断日志
    expect(mockWarn).toHaveBeenCalledOnce();
    const [logData, logKey] = mockWarn.mock.calls[0];
    expect(logKey).toBe("mcp.endpoint.not_found");
    expect(logData).toMatchObject({
      path: "/some/random/path",
      method: "GET",
      registeredEndpoints: ["server-a", "server-b"],
    });
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

    // 列出端点不应触发 warn 日志
    expect(mockWarn).not.toHaveBeenCalled();
  });

  /** GET 获取存在的 MCP Server 信息 */
  it("returns server info for existing server via GET", async () => {
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

    // 正常路由不应触发 warn 日志
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
