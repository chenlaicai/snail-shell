import { InMemoryMCPServerRepository } from "./repository";
import { MCPServerAdapter } from "./adapter";

/** 初始化 MCP Server 模块 */
export function init() {
  const repo = new InMemoryMCPServerRepository();
  const adapter = new MCPServerAdapter(repo);
  return { repo, adapter };
}
