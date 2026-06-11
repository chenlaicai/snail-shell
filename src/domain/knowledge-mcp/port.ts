import type {
  SearchKnowledgeInput,
  SearchKnowledgeOutput,
  ListKnowledgeInput,
  ListKnowledgeOutput,
  AddKnowledgeInput,
  AddKnowledgeOutput,
  RemoveKnowledgeInputDto,
} from "./model";

/**
 * Knowledge MCP Server 端口定义。
 * Agent 通过 MCP 工具调用 knowledge 功能。
 */
export interface KnowledgeMCPPort {
  /** 搜索知识条目 */
  search(input: SearchKnowledgeInput): SearchKnowledgeOutput;

  /** 列出知识条目 */
  list(input: ListKnowledgeInput): ListKnowledgeOutput;

  /** 创建知识条目 */
  add(input: AddKnowledgeInput): AddKnowledgeOutput;

  /** 删除知识条目 */
  remove(input: RemoveKnowledgeInputDto): void;
}
