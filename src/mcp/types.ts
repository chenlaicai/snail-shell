/**
 * MCP 域公开类型。
 *
 * MCP (Model Context Protocol) 服务器配置。
 */

/** MCP 服务器配置 */
export interface McpServerConfig {
  /** 服务器名称 */
  name: string;
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
