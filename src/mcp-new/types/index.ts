/**
 * MCP 模块公开类型
 *
 * 定义 MCP 服务注册和管理的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 不依赖其他模块的类型
 * - 通过 Registry 接口访问 MCP
 */

/**
 * MCP Server 实体
 */
export interface McpServer {
  /** Server 名称 */
  name: string;
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args: string[];
  /** 环境变量 */
  env: Record<string, string>;
}

/**
 * MCP Tool 实体
 */
export interface McpTool {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入 Schema */
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Server 配置
 */
export interface McpServerConfig {
  /** Server 名称 */
  name: string;
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args: string[];
  /** 环境变量 */
  env: Record<string, string>;
  /** 是否为内置 Server */
  builtin?: boolean;
}
