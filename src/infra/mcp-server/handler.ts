import { Hono } from "hono";
import { getLogger } from "@infra/logger";
import type { SnailMCPServerPort } from "@domain/snail-mcp-server/port";
import type { JsonRpcRequest } from "@domain/snail-mcp-server/model";

const log = getLogger({ module: "mcp-server" });

/**
 * MCP HTTP 处理器。
 * 为每个 MCP Server 创建独立的端点。
 */
export function createMcpHandler(port: SnailMCPServerPort): Hono {
  const app = new Hono();

  // 列出所有 MCP Server
  app.get("/", (c) => {
    const servers = port.listServers();
    return c.json({
      servers: servers.map(s => ({
        name: s.name,
        version: s.version,
        endpoint: `/mcp-server/${s.name}`,
        tools: s.tools.map(t => t.name),
      })),
    });
  });

  // 获取 MCP Server 信息
  app.get("/:serverName", (c) => {
    const serverName = c.req.param("serverName");
    const server = port.findServer(serverName);
    if (!server) {
      const registeredEndpoints = port.listServers().map(s => s.name);
      log.warn({ path: c.req.path, method: c.req.method, registeredEndpoints }, "mcp.endpoint.not_found");
      return c.json({ error: "Server not found" }, 404);
    }
    return c.json({
      name: server.name,
      version: server.version,
      endpoint: `/mcp-server/${server.name}`,
      tools: server.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  });

  // 处理 JSON-RPC 请求（每个 MCP Server 独立端点）
  app.post("/:serverName", async (c) => {
    const serverName = c.req.param("serverName");
    try {
      const body = await c.req.json<JsonRpcRequest>();
      const response = await port.handleRequest(serverName, body);
      return c.json(response);
    } catch (err) {
      log.warn({ err, serverName }, "mcp.handler.error");
      return c.json({ jsonrpc: "2.0", error: { code: -32603, message: (err as Error).message } }, 500);
    }
  });

  // 全局 404 处理器：捕获所有未匹配路径并记录诊断日志
  app.notFound((c) => {
    const registeredEndpoints = port.listServers().map(s => s.name);
    log.warn({ path: c.req.path, method: c.req.method, registeredEndpoints }, "mcp.endpoint.not_found");
    return c.text("Not Found", 404);
  });

  return app;
}
