import type { KnowledgeEntry, CreateKnowledgeInput, RemoveKnowledgeInput } from "@domain/knowledge/model";

/**
 * Knowledge MCP Server 工具定义。
 * Agent 通过 MCP 工具调用 knowledge 功能。
 */

/** 搜索知识条目输入 */
export interface SearchKnowledgeInput {
  /** 搜索关键词 */
  query: string;
  /** 工作区路径（可选，不传则只搜索平台级） */
  workspace_path?: string;
}

/** 搜索知识条目输出 */
export interface SearchKnowledgeOutput {
  items: KnowledgeEntry[];
}

/** 列出知识条目输入 */
export interface ListKnowledgeInput {
  /** 工作区路径（可选，不传则列出所有） */
  workspace_path?: string;
}

/** 列出知识条目输出 */
export interface ListKnowledgeOutput {
  items: KnowledgeEntry[];
}

/** 创建知识条目输入 */
export interface AddKnowledgeInput {
  /** 条目 ID */
  id: string;
  /** 标题 */
  title: string;
  /** 标签 */
  tags?: string[];
  /** 内容 */
  content: string;
  /** 作用域 */
  scope: "platform" | "workspace";
  /** 工作区路径（scope=workspace 时必填） */
  workspace_path?: string;
}

/** 创建知识条目输出 */
export interface AddKnowledgeOutput {
  entry: KnowledgeEntry;
}

/** 删除知识条目输入 */
export interface RemoveKnowledgeInputDto {
  /** 条目 ID */
  id: string;
  /** 作用域 */
  scope: "platform" | "workspace";
  /** 工作区路径（scope=workspace 时必填） */
  workspace_path?: string;
}
