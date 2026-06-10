import type { MCPServerCapability, MCPTool, MCPServerInfo } from "./model";

/** MCP Server 端口定义 */
export interface MCPServerPort {
  /** 获取 server 信息 */
  getServerInfo(): MCPServerInfo;

  /** 列出所有暴露的工具 */
  listTools(): MCPTool[];

  /** 注册平台级 MCP Server */
  registerPlatformServer(server: MCPServerCapability): void;

  /** 获取所有已注册的 MCP Server（平台 + workspace） */
  getActiveServers(workspaceRoot?: string): MCPServerCapability[];
}
