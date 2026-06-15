import type { Workspace, CreateWorkspaceInput } from "@domain/workspace/model";

/** Workspace 端口定义 */
export interface WorkspacePort {
  /** 分页列出所有 workspace */
  list(limit?: number, offset?: number): Workspace[];

  /** 新增 workspace，路径重复抛异常 */
  add(input: CreateWorkspaceInput): Workspace;

  // TODO: remove 方法需要先清理 ws 下的 skill/prompt/sop 等业务数据
}
