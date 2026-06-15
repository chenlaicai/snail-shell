import type { Workspace, Scope } from "@domain/workspace/model";

/** Agent Skill 定义 */
export interface Skill {
  /** Skill 唯一标识，来自 frontmatter name */
  name: string;
  /** 描述 */
  description: string;
  /** markdown 正文 */
  content: string;
  /** 作用域：platform 平台级，workspace 工作区级 */
  scope: Scope;
  /** 来源 workspace（workspace 来源时有值） */
  workspace?: Workspace;
  /** skill 目录绝对路径（用于路径映射给 agent） */
  dir_path: string;
}
