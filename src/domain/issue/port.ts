import type { Issue, CreateIssueInput, Stage, CreateStageInput, RoleSnailSession, StagePreview } from "./model";

/** Issue 端口 */
export interface IssuePort {
  findIssue(id: string): Issue | undefined;
  listIssues(workspacePath: string, limit?: number, offset?: number): Issue[];
  createIssue(input: CreateIssueInput): Issue;
}

/** Stage 端口 */
export interface StagePort {
  findStage(id: string): Stage | undefined;
  listStages(issueId: string): Stage[];
  /** 预览 stage 定义（只读，不创建），供页面展示角色实例供用户选择 snail */
  previewStage(issueId: string, stageKey: string): StagePreview;
  createStage(input: CreateStageInput): Stage;

  /** 写入产物（合并，不覆盖已有） */
  addOutputArtifacts(stageId: string, artifacts: Record<string, string>): void;

  /** 流转到下一个 Stage：设置当前 left_at + 创建新 Stage */
  advanceStage(currentStageId: string, targetKey: string, snailAssignments: Record<string, string>): Stage;

  /** 切换 snail：追加新 RoleSnailSession 记录（seq+1） */
  switchSnail(stageId: string, roleInstance: string, newSnailId: string): void;

  /** 追加 session ID 到当前 RoleSnailSession 的 external_session_ids */
  appendSessionId(stageId: string, roleInstance: string, sessionId: string): void;

  /** 获取 stage 所有角色实例的当前（最新）snail 分配 */
  getRoleSnailSessions(stageId: string): RoleSnailSession[];

  /** 获取指定角色实例的当前（最新）snail 分配 */
  getRoleSnailSession(stageId: string, roleInstance: string): RoleSnailSession | null;

  /** 获取指定角色的 handbook 内容（从 SOP 快照中读取） */
  getRoleHandbook(stageId: string, roleKey: string): string | null;
}
