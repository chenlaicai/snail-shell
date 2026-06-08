/**
 * Hono 路由挂载。
 *
 * 将 MCP JSON-RPC endpoint 注册到 Hono app。
 * 纯适配层：HTTP 请求/响应 ↔ McpServerService 接口。
 */

import type { Hono } from 'hono';
import type { McpServerService } from '@/mcp-server/api.js';

export function registerMcpRoutes(app: Hono, service: McpServerService, path: string): void {
  app.post(path, async (c) => {
    const body = await c.req.json();

    // 基本校验
    if (!body || typeof body !== 'object') {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }

    const response = service.handleJsonRpc(body);
    // notification 无响应
    if (response === null) {
      return c.body(null, 204);
    }
    return c.json(response);
  });
}
