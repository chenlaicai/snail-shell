import type { Workspace } from "@domain/workspace/model";

/** 原则性 Prompt 文档 */
export interface PromptDocument {
  /** 文档唯一标识，来自 frontmatter id */
  id: string;
  /** 显示标题 */
  title: string;
  /** markdown 正文 */
  content: string;
  /** 标签列表，用于条件匹配 */
  tags: string[];
  /** 来源：platform 平台级，workspace 工作区级 */
  source: "platform" | "workspace";
  /** 来源 workspace（workspace 来源时有值） */
  workspace?: Workspace;
}
