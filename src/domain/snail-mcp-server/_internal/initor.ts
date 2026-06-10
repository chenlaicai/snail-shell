import { SnailMCPServerAdapter } from "./adapter";

/** 初始化 Snail MCP Server 模块 */
export function init() {
  const adapter = new SnailMCPServerAdapter();
  return { adapter };
}
