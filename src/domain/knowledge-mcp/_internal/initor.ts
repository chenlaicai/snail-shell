import type { KnowledgePort } from "@domain/knowledge/port";
import { KnowledgeMCPAdapter } from "./adapter";

/** 初始化 Knowledge MCP 模块 */
export function init(knowledge: KnowledgePort) {
  const adapter = new KnowledgeMCPAdapter(knowledge);
  return { adapter };
}
