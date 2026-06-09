/**
 * MCP Registry 接口
 *
 * 定义 MCP 服务注册表的接口。
 *
 * 设计原则：
 * - 接口定义在原子模块中
 * - 实现在 database 模块中
 * - 原子模块通过接口访问 MCP
 */

import type { McpServer, McpTool } from "../types";

/**
 * MCP Registry 接口
 *
 * 定义 MCP 服务注册表的操作。
 */
export interface McpRegistry {
  /**
   * 注册 MCP Server
   * @param server MCP Server
   */
  registerServer(server: McpServer): void;

  /**
   * 获取 MCP Server
   * @param name Server 名称
   * @returns MCP Server，不存在返回 null
   */
  getServer(name: string): McpServer | null;

  /**
   * 获取所有 MCP Server
   * @returns MCP Server 列表
   */
  listServers(): McpServer[];

  /**
   * 获取 MCP Server 的工具列表
   * @param serverName Server 名称
   * @returns 工具列表
   */
  getTools(serverName: string): McpTool[];
}
