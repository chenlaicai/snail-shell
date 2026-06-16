import type { Workspace } from "@domain/workspace/model";
import type { MCPConfig } from "@domain/mcp/model";

/** MCP 配置管理端口定义 */
export interface MCPPort {
  /** 列出所有 MCP 配置 */
  list(): MCPConfig[];

  /** 获取指定 workspace 的 MCP 配置（平台 + 该 workspace） */
  findByWorkspace(workspace: Workspace): MCPConfig[];
}
