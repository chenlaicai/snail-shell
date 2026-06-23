import type { Workspace, Scope } from "@domain/workspace/model";

/** MCP Server 配置（MCP 协议标准 + Snail Shell 元数据） */
export interface MCPConfig {
  // MCP 协议标准字段
  /** Server 名称 */
  name: string;
  /** stdio 传输：启动命令 */
  command?: string;
  /** stdio 传输：命令参数 */
  args?: string[];
  /** stdio 传输：环境变量 */
  env?: Record<string, string>;
  /** HTTP 传输：端点 URL */
  url?: string;

  // Snail Shell 特有字段
  /** 作用域：platform 平台级，workspace 工作区级 */
  scope: Scope;
  /** 配置来源：builtin 内建注入、platform 平台配置、workspace 工作区配置 */
  source?: 'builtin' | 'platform' | 'workspace';
  /** 关联的工作空间（workspace 来源时有值） */
  workspace?: Workspace;
}
