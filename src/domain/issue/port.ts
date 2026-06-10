import type { Issue, Stage, CreateIssueInput, CreateIssueResult } from "./model";

/** Issue 端口定义 */
export interface IssuePort {
  /** 按 ID 查找 Issue */
  findById(id: string): Issue | undefined;

  /** 列出 workspace 下的 Issue */
  listByWorkspace(workspaceId: string, limit?: number, offset?: number): Issue[];

  /** 创建 Issue（原子创建 Issue + Stage + Conversation） */
  create(input: CreateIssueInput): CreateIssueResult;

  /** 按 ID 查找 Stage */
  findStageById(id: string): Stage | undefined;

  /** 列出 Issue 下的 Stage */
  listStages(issueId: string): Stage[];
}
