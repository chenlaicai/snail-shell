/**
 * MCP 域公开 API — 接口层。
 */

import type { McpServerConfig } from '@/mcp/types.js';

/** MCP 服务接口 */
export interface McpService {
  /** 列出平台级 MCP 服务器 */
  listPlatform(): McpServerConfig[];

  /** 列出工作区级 MCP 服务器（从 .snail/mcp.json 加载） */
  listWorkspace(): McpServerConfig[];

  /** 合并平台级 + 工作区级（同名冲突报错） */
  listAll(): McpServerConfig[];

  /** 注册平台级 MCP 服务器（启动时调用） */
  registerPlatformServer(config: McpServerConfig): void;
}
