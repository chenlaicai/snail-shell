/** Agent 类型 */
export type AgentType = "claude" | "opencode" | "codex";

/** MCP 配置注入结果 */
export interface MCPConfigResult {
  /** 写入的配置文件路径 */
  configPath: string;
  /** 写入的 MCP Server 数量 */
  serverCount: number;
}
