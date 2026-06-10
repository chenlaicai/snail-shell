/** MCP Server 能力描述 */
export interface MCPServerCapability {
  /** Server 名称 */
  name: string;
  /** stdio transport: 命令 */
  command?: string;
  /** stdio transport: 参数 */
  args?: string[];
  /** stdio transport: 环境变量 */
  env?: Record<string, string>;
  /** HTTP transport: URL */
  url?: string;
}

/** MCP 工具定义 */
export interface MCPTool {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入参数 schema */
  inputSchema: Record<string, unknown>;
}

/** MCP Server 信息 */
export interface MCPServerInfo {
  name: string;
  version: string;
}
