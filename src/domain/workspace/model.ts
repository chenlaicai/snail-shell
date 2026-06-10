/**
 * Workspace 本质就是一个目录。
 * path 是主键，也是 agent 的工作目录。
 */

export interface Workspace {
  /** 工作区绝对路径，主键 */
  path: string;
  summary: string | null;
}

export interface CreateWorkspaceInput {
  path: string;
  summary?: string;
}
