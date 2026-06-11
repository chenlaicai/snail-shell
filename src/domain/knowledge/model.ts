import type { Workspace, Scope } from "@domain/workspace/model";

/**
 * 知识库条目。
 * 每个条目一个 md 文件，scope 由文件所在目录决定。
 * 文件名格式：{id}#{title}.md
 */
export interface KnowledgeEntry {
  /** 条目唯一标识（来自 frontmatter） */
  id: string;
  /** 标题（来自 frontmatter） */
  title: string;
  /** 标签（来自 frontmatter） */
  tags: string[];
  /** 内容（markdown 正文） */
  content: string;
  /** 作用域：由文件所在目录决定 */
  scope: Scope;
  /** 关联的工作空间（workspace 来源时有值） */
  workspace?: Workspace;
}

/** 创建知识条目输入 */
export interface CreateKnowledgeInput {
  /** 条目唯一标识 */
  id: string;
  /** 标题 */
  title: string;
  /** 标签 */
  tags?: string[];
  /** 内容 */
  content: string;
  /** 作用域 */
  scope: Scope;
  /** 关联的工作空间（workspace 来源时必填） */
  workspace?: Workspace;
}

/** 删除知识条目输入 */
export interface RemoveKnowledgeInput {
  /** 作用域 */
  scope: Scope;
  /** 关联的工作空间（workspace 来源时必填） */
  workspace?: Workspace;
  /** 条目唯一标识 */
  id: string;
}
