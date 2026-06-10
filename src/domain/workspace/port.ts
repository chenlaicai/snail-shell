import type { Workspace, CreateWorkspaceInput } from "./model";

/** Workspace 端口定义 */
export interface WorkspacePort {
  /** 按路径查找，不存在返回 undefined */
  findByPath(path: string): Workspace | undefined;

  /** 分页列出所有 workspace */
  list(limit?: number, offset?: number): Workspace[];

  /** 新增 workspace，路径重复抛异常 */
  create(input: CreateWorkspaceInput): Workspace;

  /** 删除 workspace，不存在抛异常 */
  delete(path: string): void;
}
