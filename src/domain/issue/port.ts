import type { Issue, Stage, CreateStageInput, RoleSnailAssignment, StagePreview, IssueSnailAssignmentPlan, StageSnailAssignmentPlan } from "@domain/issue/model";
import type { Sop } from "@domain/sop/model";

/** Issue 端口 */
export interface IssuePort {
  findIssue(id: string): Issue | undefined;
  listIssues(workspacePath: string, limit?: number, offset?: number): Issue[];
  previewSopStages(adoptedSopKey: string, title: string): StagePreview[];
  validateSnailAssignmentPlan(sop: Sop, plan: IssueSnailAssignmentPlan): void;
  /** 更新 Issue 上下文（merge 语义） */
  updateContext(issueId: string, context: Record<string, string>): void;
  /** 关闭 issue（用户主动终止，任意阶段可调用，幂等） */
  closeIssue(id: string): Issue;
}

/** Stage 端口 */
export interface StagePort {
  findStage(id: string): Stage | undefined;
  listStages(issueId: string): Stage[];
  /** 返回 issue 未关闭的 stage ID 子集 */
  listOpenStageIds(stageIds: string[]): string[];
  /** 返回所有 open stage ID（未 left 且 issue 未 closed） */
  listAllOpenStageIds(): string[];
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
