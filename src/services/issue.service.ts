/**
 * Issue Service — Issue 生命周期的跨模块编排。
 *
 * 编排模块：workspace, sop, issue, snail
 */

import type { Issue, Stage, TaskAnchor } from '@/issue/types.js';
import type { SopSnapshot } from '@/sop/types.js';

/** 创建 Issue 的输入参数 */
export interface CreateIssueInput {
  workspace_id: string;
  title: string;
  summary?: string;
  task_anchor?: TaskAnchor;
  sop_id: string;
}

/** 创建 Issue 的结果 */
export interface CreateIssueResult {
  issue: Issue;
  initial_stage: Stage;
  initial_conversation_id: string;
}

/**
 * Issue Service 接口。
 *
 * 跨模块编排：读 SOP → 读 workspace → 解析 snail 模板 → 创建 Issue + Stage + Conversation
 */
export interface IssueService {
  /** 创建 Issue（含初始 Stage 和 Conversation） */
  createIssue(input: CreateIssueInput): Promise<CreateIssueResult>;

  /** 推进到下一个 Stage */
  advanceStage(issueId: string, currentStageId: string): Promise<Stage>;

  /** 回退到上一个 Stage */
  revertStage(issueId: string, currentStageId: string): Promise<Stage>;

  /** 完成 Issue */
  completeIssue(issueId: string): Promise<Issue>;

  /** 获取 Issue 详情（含当前 Stage 和 Conversation） */
  getIssueDetail(issueId: string): Promise<IssueDetail>;
}

/** Issue 详情（聚合视图） */
export interface IssueDetail {
  issue: Issue;
  current_stage: Stage | undefined;
  sop_snapshot: SopSnapshot;
}
