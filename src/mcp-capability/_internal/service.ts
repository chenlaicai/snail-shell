/**
 * MCP Capability 服务实现。
 *
 * 外部禁止 import，通过 mcp-capability/api.ts 接口访问。
 * 启动时在 main.ts 中实例化。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { McpCapabilityService } from '@/mcp-capability/api.js';
import type { McpServerConfig } from '@/mcp-capability/types.js';

export class McpCapabilityServiceImpl implements McpCapabilityService {
  private platformServers: McpServerConfig[] = [];

  constructor(private workspaceRoot?: string) {}

  registerPlatformServer(config: McpServerConfig): void {
    const existing = this.platformServers.findIndex(s => s.name === config.name);
    if (existing >= 0) {
      this.platformServers[existing] = config;
    } else {
      this.platformServers.push(config);
    }
  }

  listPlatformServers(): McpServerConfig[] {
    return [...this.platformServers];
  }

  listWorkspaceServers(): McpServerConfig[] {
    if (!this.workspaceRoot) return [];
    return loadWorkspaceMcpServers(this.workspaceRoot);
  }

  collectAllServers(): McpServerConfig[] {
    const merged = new Map<string, McpServerConfig>();

    for (const server of this.platformServers) {
      merged.set(server.name, server);
    }

    for (const server of this.listWorkspaceServers()) {
      if (merged.has(server.name)) {
        throw new Error(
          `MCP server name conflict: "${server.name}" is registered by both platform and workspace. ` +
          `MCP server names must be unique across platform and workspace.`
        );
      }
      merged.set(server.name, server);
    }

    return [...merged.values()];
  }

  getPlatformServerNames(): Set<string> {
    return new Set(this.platformServers.map(s => s.name));
  }
}

/** 从 .snail/mcp.json 加载 workspace 级 MCP server */
function loadWorkspaceMcpServers(workspaceRoot: string): McpServerConfig[] {
  const mcpJsonPath = path.join(workspaceRoot, '.snail', 'mcp.json');
  if (!fs.existsSync(mcpJsonPath)) return [];

  try {
    const raw = fs.readFileSync(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.mcpServers !== 'object' || parsed.mcpServers === null) return [];

    return Object.entries(parsed.mcpServers).map(([name, config]) => {
      const c = config as Record<string, unknown>;
      const command = typeof c.command === 'string' ? c.command : undefined;
      const url = typeof c.url === 'string' ? c.url : undefined;
      return {
        name,
        transport: command ? 'stdio' : 'http',
        command,
        args: Array.isArray(c.args) ? c.args as string[] : undefined,
        env: typeof c.env === 'object' && c.env !== null ? c.env as Record<string, string> : undefined,
        url,
        source: 'workspace' as const,
      };
    });
  } catch {
    /** 容错：.snail/mcp.json 解析失败时不阻断启动，降级为无 workspace MCP */
    return [];
  }
}
