/**
 * MCP Capability 前端 API routes。
 *
 * 展示平台+workspace 的 MCP server 配置列表。
 * 调用 mcp-capability/api.ts 接口，不直接依赖实现。
 */

import type { Hono } from 'hono';
import type { McpCapabilityService } from '@/mcp-capability/api.js';

export function registerMcpCapabilityApiRoutes(app: Hono, service: McpCapabilityService): void {
  /** GET /api/mcp-capability/servers — 合并后的完整 MCP server 列表 */
  app.get('/api/mcp-capability/servers', (c) => {
    try {
      const servers = service.collectAllServers();
      return c.json(servers);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
  });

  /** GET /api/mcp-capability/platform-servers — 平台级 MCP server 列表 */
  app.get('/api/mcp-capability/platform-servers', (c) => {
    return c.json(service.listPlatformServers());
  });

  /** GET /api/mcp-capability/workspace-servers — workspace 级 MCP server 列表 */
  app.get('/api/mcp-capability/workspace-servers', (c) => {
    return c.json(service.listWorkspaceServers());
  });
}
