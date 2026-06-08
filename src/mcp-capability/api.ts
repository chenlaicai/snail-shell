/**
 * MCP Capability 域公开 API — 接口层。
 *
 * 调用方只 import 本文件，不关心实现细节。
 * 实现在 _internal/service.ts，启动时绑定。
 */

import type { McpServerConfig } from '@/mcp-capability/types.js';

/** MCP Capability 服务接口 */
export interface McpCapabilityService {
  /** 注册平台级 MCP server（启动时调用，同名则更新） */
  registerPlatformServer(config: McpServerConfig): void;

  /** 获取平台级 MCP servers */
  listPlatformServers(): McpServerConfig[];

  /** 获取 workspace 级 MCP servers（从 .snail/mcp.json 加载） */
  listWorkspaceServers(): McpServerConfig[];

  /** 合并平台 + workspace MCP servers（同名冲突抛 Error） */
  collectAllServers(): McpServerConfig[];

  /** 获取平台内置 MCP server 名称集合（供 UI 区分） */
  getPlatformServerNames(): Set<string>;
}
