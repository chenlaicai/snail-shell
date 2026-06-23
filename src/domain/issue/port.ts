import type { Issue, Stage, CreateStageInput, RoleSnailAssignment, StagePreview, IssueSnailAssignmentPlan, StageSnailAssignmentPlan } from "@domain/issue/model";
import type { Sop } from "@domain/sop/model";

/** Issue 端口 */
export interface IssuePort {
  findIssue(id: string): Issue | undefined;
  listIssues(workspacePath: string, limit?: number, offset?: number): Issue[];
  previewSopStages(adoptedSopKey: string, title: string): StagePreview[];
  validateSnailAssignmentPlan(sop: Sop, plan: IssueSnailAssignmentPlan): void;
  /** 归档 issue：设置 archived_at，幂等操作（已归档直接返回） */
  archiveIssue(id: string): Issue;
}

/** Stage 端口 */
export interface StagePort {
  findStage(id: string): Stage | undefined;
  listStages(issueId: string): Stage[];
  /** 预览 stage 定义（只读，不创建），供页面展示角色实例供用户选择 snail */
  previewStage(issueId: string, stageKey: string): StagePreview;
  getStageSnailAssignmentPlan(issueId: string, stageKey: string): StageSnailAssignmentPlan;
  transaction<T>(fn: () => T): T;
  createStage(input: CreateStageInput): Stage;

  /** 写入产物（合并，不覆盖已有） */
  addOutputArtifacts(stageId: string, artifacts: Record<string, string>): void;

  /** 流转到下一个 Stage：设置当前 left_at + 创建新 Stage */
  advanceStage(currentStageId: string, targetKey: string): Stage;

  /** 切换 snail：追加新 RoleSnailAssignment 记录（seq+1） */
  switchSnail(stageId: string, roleInstance: string, newSnailId: string): void;

  /** 设置 snail 实例 ID（首次调用 snail 后填入） */
  setSnailInstanceId(stageId: string, roleInstance: string, snailInstanceId: string): void;

  /** 获取 stage 所有角色实例的当前（最新）snail 分配 */
  getRoleSnailAssignments(stageId: string): RoleSnailAssignment[];

  /** 获取指定角色实例的当前（最新）snail 分配 */
  getRoleSnailAssignment(stageId: string, roleInstance: string): RoleSnailAssignment | null;
}
