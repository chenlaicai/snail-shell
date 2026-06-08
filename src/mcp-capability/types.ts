/**
 * MCP Capability 域公开类型。
 *
 * MCP server 配置：描述一个 MCP server 的连接方式。
 * 平台级和 workspace 级共用同一类型。
 */

/** MCP server transport 类型 */
export type McpTransportType = 'stdio' | 'http';

/** MCP server 配置 */
export interface McpServerConfig {
  /** 服务器名称（唯一标识） */
  name: string;
  /** transport 类型 */
  transport: McpTransportType;
  /** stdio transport: 启动命令 */
  command?: string;
  /** stdio transport: 命令参数 */
  args?: string[];
  /** stdio transport: 环境变量 */
  env?: Record<string, string>;
  /** HTTP transport: MCP endpoint URL */
  url?: string;
  /** 来源：platform 为平台级，workspace 为工作区级 */
  source: 'platform' | 'workspace';
}
