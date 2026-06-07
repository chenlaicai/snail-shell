/**
 * Issue lifecycle mutation service.
 *
 * Pure functions extracted from WorkspaceManager that operate on issues,
 * stages, and their lifecycle transitions.
 */
import type { ConversationStore, Issue, Stage } from "../persistence/store";
import { logger } from "../logger";
import { transitionIssueStage, createIssueWorkflow } from "./workflow";
import { cleanupIssueRepoContext, type RepoCleanupResult } from "./repo-cleanup";
import { SopSnapshotReader } from "./sop-snapshot-reader";
import { buildIssueDetail, buildStageDetail, assertIssueWritable, assertStageCanAdvance } from "./manager-detail";
import type { IssueDetail, StageDetail } from "./manager-types";

export interface IssueServiceDeps {
  store: ConversationStore;
  repoRoot: string;
}

// eslint-disable-next-line max-params -- matches original WorkspaceManager signature
export function createIssue(
  deps: IssueServiceDeps,
  workspaceId: string,
  title: string,
  summary: string | undefined,
  adoptedSopId: string,
  roleSnailMapping: Record<string, Record<string, string>>,
) {
  const workspace = deps.store.fileConfigStore.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  const result = createIssueWorkflow({ store: deps.store }, { workspace, title, summary, adoptedSopId, roleSnailMapping });
  logger.info("IssueService created issue workflow", { workspaceId, issueId: result.issue.id, stageId: result.stage.id, conversationId: result.conversation.id });
  return result;
}

export function getIssue(deps: IssueServiceDeps, issueId: string): IssueDetail | null {
  const f = deps.store.getIssue(issueId);
  return f ? buildIssueDetail(deps.store, f) : null;
}

export function listIssues(deps: IssueServiceDeps, workspaceId: string): IssueDetail[] {
  return deps.store.listIssues(workspaceId).map((f) => buildIssueDetail(deps.store, f));
}

export function listStages(deps: IssueServiceDeps, workspaceId: string): StageDetail[] {
  return deps.store.listStages(workspaceId).map((s) => buildStageDetail(deps.store, s));
}

export function getStage(deps: IssueServiceDeps, stageId: string): StageDetail | null {
  const s = deps.store.getStage(stageId);
  return s ? buildStageDetail(deps.store, s) : null;
}

export function advanceIssue(
  deps: IssueServiceDeps,
  issueId: string,
  targetStageKey?: string,
  pendingStageSuggestions?: Map<string, unknown>,
) {
  const { store } = deps;
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  assertIssueWritable(store, issue);
  const workspace = store.fileConfigStore.getWorkspace(issue.workspace_id);
  if (!workspace) throw new Error(`Workspace not found: ${issue.workspace_id}`);
  const activeStage = store.getActiveStage(issueId);
  if (!activeStage) throw new Error(`No active stage found for issue: ${issueId}`);
  assertStageCanAdvance(store, activeStage.id);
  pendingStageSuggestions?.delete(issueId);
  const result = transitionIssueStage({ store }, { workspace, issue, activeStage, targetStageKey });
  logger.info("IssueService transitioned issue", { workspaceId: workspace.id, issueId, completedStageId: result.completed_stage.id, nextStageId: result.next_stage?.id ?? null, nextConversationId: result.conversation?.id ?? null });
  return { ...result, completed_stage: buildStageDetail(store, result.completed_stage), next_stage: result.next_stage ? buildStageDetail(store, result.next_stage) : null };
}

/**
 * 显式阶段转移（用户指定目标 stage）。
 *
 * 与 advanceIssue 不同，此方法不调用 assertStageCanAdvance。
 * 设计意图：advanceIssue 是自动推进，需要 output_artifacts 守卫；
 * transitionIssueStageForIssue 是用户显式指定目标，用户有完全控制权。
 * [待确认] 此差异是否为有意设计。
 */
export function transitionIssueStageForIssue(
  deps: IssueServiceDeps,
  issueId: string,
  targetStageKey: string,
  pendingStageSuggestions?: Map<string, unknown>,
) {
  const { store } = deps;
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  assertIssueWritable(store, issue);
  const workspace = store.fileConfigStore.getWorkspace(issue.workspace_id);
  if (!workspace) throw new Error(`Workspace not found: ${issue.workspace_id}`);
  const activeStage = store.getActiveStage(issueId);
  if (!activeStage) throw new Error(`No active stage found for issue: ${issueId}`);
  const result = transitionIssueStage({ store }, { workspace, issue, activeStage, targetStageKey });
  pendingStageSuggestions?.delete(issueId);
  logger.info("IssueService transitioned issue stage", { workspaceId: workspace.id, issueId, completedStageId: result.completed_stage.id, nextStageId: result.next_stage?.id, nextConversationId: result.conversation?.id });
  return { ...result, completed_stage: buildStageDetail(store, result.completed_stage), next_stage: result.next_stage ? buildStageDetail(store, result.next_stage) : null };
}

export function setIssueTaskAnchor(deps: IssueServiceDeps, issueId: string, taskAnchor: string): Issue {
  const { store } = deps;
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  assertIssueWritable(store, issue);
  return store.updateIssue(issueId, { task_anchor: taskAnchor });
}

// eslint-disable-next-line max-params -- matches original WorkspaceManager signature
export function setIssueRoleSnail(
  deps: IssueServiceDeps,
  issueId: string,
  stageKey: string,
  roleKey: string,
  snailTemplateId: string,
  snailDen: { getTemplate: (id: string) => unknown },
): Issue {
  const { store } = deps;
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  assertIssueWritable(store, issue);
  const template = snailDen.getTemplate(snailTemplateId);
  if (!template) throw new Error(`Snail template not found: ${snailTemplateId}`);
  const reader = new SopSnapshotReader(issue.sop_snapshot);
  const roleKeys = reader.collectSopRoleKeys();
  if (!roleKeys.has(roleKey)) throw new Error(`Invalid role key '${roleKey}' in SOP snapshot`);
  const updated = { ...issue.role_snail_mapping };
  if (!updated[stageKey]) updated[stageKey] = {};
  updated[stageKey][roleKey] = snailTemplateId;
  return store.updateIssue(issueId, { role_snail_mapping: updated });
}

export function completeIssue(deps: IssueServiceDeps, issueId: string): { issue: Issue; cleanup: RepoCleanupResult } {
  const { store, repoRoot } = deps;
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  assertIssueWritable(store, issue);
  const stages = store.listStagesByIssue(issueId);
  const cleanup = cleanupIssueRepoContext(stages, { repoRoot });
  const completedIssue = store.updateIssue(issueId, { closed_at: new Date().toISOString() });
  logger.info("IssueService completed issue", { issueId, cleanup });
  return { issue: completedIssue, cleanup };
}

export function archiveIssue(deps: IssueServiceDeps, issueId: string): { issue: Issue; cleanup: RepoCleanupResult } {
  const { store, repoRoot } = deps;
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);
  const stages = store.listStagesByIssue(issueId);
  const cleanup = cleanupIssueRepoContext(stages, { repoRoot });
  const archivedIssue = store.updateIssue(issueId, { closed_at: issue.closed_at ?? new Date().toISOString() });
  logger.info("IssueService archived issue", { issueId, cleanup });
  return { issue: archivedIssue, cleanup };
}

export function updateStage(
  deps: IssueServiceDeps,
  stageId: string,
  updates: Partial<Pick<Stage, "status" | "output_artifacts" | "gate_evidence" | "entered_at" | "left_at">>,
): Stage {
  const { store } = deps;
  const stage = store.getStage(stageId);
  if (!stage) throw new Error(`Stage not found: ${stageId}`);
  assertIssueWritable(store, store.getIssue(stage.issue_id)!);
  return store.updateStage(stageId, updates);
}
