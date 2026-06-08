/**
 * MCP Server 前端 API routes。
 *
 * 展示 Snail Shell 作为 MCP server 的信息和工具列表。
 * 调用 mcp-server/api.ts 接口，不直接依赖实现。
 */

import type { Hono } from 'hono';
import type { McpServerService } from '@/mcp-server/api.js';

export function registerMcpServerApiRoutes(app: Hono, service: McpServerService): void {
  /** GET /api/mcp-server/info — server 元信息 */
  app.get('/api/mcp-server/info', (c) => {
    return c.json(service.getServerInfo());
  });

  /** GET /api/mcp-server/tools — 暴露的工具列表 */
  app.get('/api/mcp-server/tools', (c) => {
    return c.json(service.getTools());
  });
}
