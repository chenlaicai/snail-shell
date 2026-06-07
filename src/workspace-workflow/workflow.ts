import { randomUUID } from "crypto";
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import type { Conversation, ConversationStore, Issue, Workspace, Stage, StageGateEvidence, StageGateArtifact, StageChecklistItem, SopTransition, SopSnapshot } from "../persistence/store";
import type { FileConfigStore } from "../persistence/file-config-store";
import { SopSnapshotReader } from "./sop-snapshot-reader";
import { logger } from "../logger";

export interface IssueWorkflowResult {
  issue: Issue;
  stage: Stage;
  conversation: Conversation;
}

export interface IssueTransitionResult {
  completed_stage: Stage;
  next_stage: Stage | null;
  conversation: Conversation | null;
  issue: Issue;
}

interface WorkflowDependencies {
  store: ConversationStore;
}

export function createInitialWorkflow(
  deps: WorkflowDependencies,
  input: {
    name: string;
    summary?: string;
    workspaceRoot: string;
    workspaceId?: string;
    sopId: string;
    roleSnailMapping: Record<string, Record<string, string>>;
  },
): { workspace: Workspace; issue: Issue; stage: Stage; conversation: Conversation } {
  const { name, summary, workspaceRoot, workspaceId, sopId, roleSnailMapping } = input;

  const workspace = deps.store.fileConfigStore.createWorkspace({ id: workspaceId ?? randomUUID(), name, workspaceRoot, summary });

  const issueWorkflow = createIssueWorkflow(deps, { workspace, title: "初始设计与实现", summary: "工作区创建时自动生成的默认 issue。", adoptedSopId: sopId, roleSnailMapping });
  return { workspace, ...issueWorkflow };
}

export function createIssueWorkflow(
  deps: WorkflowDependencies,
  input: { workspace: Workspace; title: string; summary?: string; fromConversationIds?: string[]; adoptedSopId: string; roleSnailMapping: Record<string, Record<string, string>> }
): IssueWorkflowResult {
  // SOP 可用性校验：通过 SOP scope 确认对当前 workspace 可用
  const sop = deps.store.fileConfigStore.getSop(input.adoptedSopId);
  if (!sop) throw new Error(`SOP not found: ${input.adoptedSopId}`);
  if (sop.source === "workspace" && sop.source_ref !== input.workspace.id) {
    throw new Error(`SOP ${input.adoptedSopId} belongs to workspace ${sop.source_ref}, not ${input.workspace.id}`);
  }

  // 捕获 SOP 全量快照
  const snapshot = buildSopSnapshot({ store: deps.store.fileConfigStore }, input.adoptedSopId);
  const reader = new SopSnapshotReader(snapshot);

  const issue = deps.store.createIssue({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    title: input.title,
    summary: input.summary,
    sopSnapshot: snapshot,
    roleSnailMapping: input.roleSnailMapping,
  });
  const firstStageKey = snapshot.first_stage ?? resolveFirstStageKey(reader);
  const stage = createIssueStage(deps, reader, { workspace: input.workspace, issue, stageKey: firstStageKey, sequence: 1 });
  const conversation = createDefaultStageConversation(deps, reader, { workspace: input.workspace, issue, stage, fromConversationIds: input.fromConversationIds ?? [] });
  return { issue, stage, conversation };
}

/**
 * 统一的 stage 转移函数。替代原 advanceIssueWorkflow 和 bounceIssueWorkflow。
 *
 * 转移流程：
 * 1. 解析目标 stage（自动或显式指定）
 * 2. 校验 guard（requires_artifacts 等）
 * 3. 校验转移边存在于 sop_transition 表
 * 4. 完成当前 stage
 * 5. 创建目标 stage + conversation
 *
 * 终态语义：当当前 stage 无出边（如 merge）时，完成当前 stage 并返回 { next_stage: null, conversation: null }，
 * 表示 Issue 流程已结束。调用方需根据 next_stage === null 判断是否到达终态。
 */
export function transitionIssueStage(
  deps: WorkflowDependencies,
  ctx: { workspace: Workspace; issue: Issue; activeStage: Stage; targetStageKey?: string },
): IssueTransitionResult {
  const { workspace, issue, activeStage, targetStageKey } = ctx;
  const reader = new SopSnapshotReader(issue.sop_snapshot);
  const resolvedTarget = resolveTransitionTarget(reader, activeStage, targetStageKey);

  /** 终态：当前 stage 无出边，完成当前 stage 后流程结束。 */
  if (resolvedTarget === null) {
    const completedStage = deps.store.updateStage(activeStage.id, { status: "completed", left_at: new Date().toISOString() });
    return { completed_stage: completedStage, next_stage: null, conversation: null, issue };
  }

  const edge = reader.validateTransition(activeStage.type, resolvedTarget);
  checkGuard(activeStage, edge);
  checkGateEvidence(reader, activeStage);

  const completedStage = deps.store.updateStage(activeStage.id, { status: "completed", left_at: new Date().toISOString() });
  const prevConversation = deps.store.getConversationByStage(activeStage.id);
  const fromConversationIds = prevConversation ? [prevConversation.id] : [];
  const nextStage = createIssueStage(deps, reader, { workspace, issue, stageKey: resolvedTarget, sequence: activeStage.sequence + 1 });
  const conversation = createDefaultStageConversation(deps, reader, { workspace, issue, stage: nextStage, fromConversationIds });
  return { completed_stage: completedStage, next_stage: nextStage, conversation, issue };
}

/**
 * 解析转移目标 stage key。
 *
 * 返回 null 表示当前 stage 为终态（无出边），调用方应完成当前 stage 并返回 next_stage: null。
 * 无出边时抛错是旧行为（硬编码路由），新行为由 SOP 转移图驱动：无出边 = 流程结束。
 */
function resolveTransitionTarget(reader: SopSnapshotReader, activeStage: Stage, targetStageKey?: string): string | null {
  const forwardEdges = reader.getForwardTransitions(activeStage.type);
  if (forwardEdges.length === 0) return null;
  if (targetStageKey) return targetStageKey;
  if (forwardEdges.length === 1) return forwardEdges[0].to_stage_key;
  const targets = forwardEdges.map((e) => e.to_stage_key).join(", ");
  throw new Error(`Stage "${activeStage.type}" has multiple forward transitions (${targets}). Specify target_stage_key.`);
}

function createIssueStage(
  deps: WorkflowDependencies,
  reader: SopSnapshotReader,
  input: { workspace: Workspace; issue: Issue; stageKey: string; sequence: number }
): Stage {
  const stageDef = reader.getSopStageDefinitionByKey(input.stageKey);
  if (!stageDef) {
    throw new Error(`Stage definition not found: ${input.stageKey} in SOP snapshot`);
  }
  return deps.store.createStage({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    issueId: input.issue.id,
    stageDefinitionId: stageDef.id,
    type: stageDef.key,
    sequence: input.sequence,
    status: "in_progress",
    enteredAt: new Date().toISOString(),
  });
}

function createDefaultStageConversation(
  deps: WorkflowDependencies,
  reader: SopSnapshotReader,
  input: { workspace: Workspace; issue: Issue; stage: Stage; fromConversationIds: string[] }
): Conversation {
  const roles = reader.listRoleDefinitionsByStage(input.stage.type);
  const primaryRole = roles.find((r) => r.is_primary === 1) ?? roles[0];
  if (!primaryRole) {
    throw new Error(`No roles configured for stage definition: ${input.stage.type} in SOP snapshot`);
  }
  return deps.store.createConversation({
    id: randomUUID(),
    workspaceId: input.workspace.id,
    issueId: input.issue.id,
    stageId: input.stage.id,
    title: `${input.issue.title} · ${input.stage.type} #${input.stage.sequence}`,
    kind: "discussion",
    defaultRole: primaryRole.name,
    participatingRoles: [HUMAN_ROLE_NAME, ...roles.map((role) => role.name)],
    summary: `Auto-created conversation for issue ${input.issue.title} stage ${input.stage.type}`,
    fromConversationIds: input.fromConversationIds,
  });
}

/**
 * 从 FileConfigStore 构建 SOP 全量快照。
 *
 * 仅在 issue 创建时调用一次，之后 issue 运行时全部从快照读取。
 */
export function buildSopSnapshot(deps: { store: Pick<FileConfigStore, "getSop" | "listSopStageDefinitionsWithRoles" | "getSopTransitions"> }, sopId: string): SopSnapshot {
  const sop = deps.store.getSop(sopId);
  if (!sop) throw new Error(`SOP not found: ${sopId}`);
  const stageDefs = deps.store.listSopStageDefinitionsWithRoles(sopId);
  const transitions = deps.store.getSopTransitions(sopId);
  return {
    sop_id: sop.id,
    source: sop.source,
    source_ref: sop.source_ref,
    name: sop.name,
    description: sop.description ?? null,
    first_stage: sop.first_stage ?? null,
    shared_handbook: sop.shared_handbook ?? null,
    stage_definitions: stageDefs.map((sd) => ({
      key: sd.key,
      title: sd.title,
      sequence: sd.sequence,
      input_description: sd.input_description ?? null,
      output_description: sd.output_description ?? null,
      acceptance_focus: sd.acceptance_focus ?? [],
      acceptance_checklist: sd.acceptance_checklist ?? [],
      roles: (sd.roles ?? []).map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description ?? "",
        is_primary: Boolean(r.is_primary),
        count: r.count ?? 1,
        handbook: r.handbook ?? null,
      })),
    })),
    transitions: transitions.map((t) => ({
      from: t.from_stage_key,
      to: t.to_stage_key,
      guard: t.guard ?? null,
    })),
  };
}

/**
 * 校验转移守卫。
 *
 * Why guard 为空时直接返回：未配置守卫等同于无条件允许转移，这是 SOP 设计的默认语义。
 * Why 只支持 requires_artifacts：当前仅需检查产物完整性，后续扩展新类型时在 switch 中增加分支即可。
 * Why 未知 guard type 抛错：fail-silent 会让拼写错误的 guard 配置被完全绕过，安全守卫必须 fail-fast。
 */
function checkGuard(activeStage: Stage, edge: SopTransition): void {
  if (!edge.guard) return;
  if (edge.guard.type === "requires_artifacts") {
    const required = edge.guard.config.artifacts as string[] | undefined;
    if (!required || required.length === 0) return;
    const artifacts = activeStage.output_artifacts ?? {};
    const missing = required.filter((key) => !artifacts[key]);
    if (missing.length > 0) {
      throw new Error(`Stage "${activeStage.type}" missing required artifacts for transition to "${edge.to_stage_key}": ${missing.join(", ")}`);
    }
    return;
  }
  throw new Error(`Unknown guard type "${edge.guard.type}" for transition ${edge.from_stage_key} → ${edge.to_stage_key}`);
}

/**
 * SOP 未配置 first_stage 时，fallback 到 sequence 最小的 stage key。
 */
function resolveFirstStageKey(reader: SopSnapshotReader): string {
  const stages = reader.listSopStageDefinitions();
  if (stages.length === 0) {
    throw new Error(`SOP snapshot has no stage definitions`);
  }
  return stages[0].key;
}

/**
 * 推进前检查 gate_evidence。
 *
 * Why: 让 AI 在阶段结束前自动检查产出完整性，人工只需最终确认。
 * 如有未通过的必需项，log.warn 提示但不阻塞——用户有最终决定权。
 */
function checkGateEvidence(reader: SopSnapshotReader, activeStage: Stage): void {
  const stageDef = reader.getStageDefinition(activeStage.type);
  if (!stageDef) return;

  const checklist: StageChecklistItem[] = stageDef.acceptance_checklist;
  if (!checklist || checklist.length === 0) return;

  const evidence: StageGateEvidence | null = activeStage.gate_evidence;
  if (!evidence || !evidence.items || evidence.items.length === 0) {
    logger.warn(`Stage ${activeStage.type} (#${activeStage.sequence}) has no gate evidence. Acceptance checklist has ${checklist.length} items.`);
    return;
  }

  const requiredItems = checklist.filter((item) => item.required);
  const missing = requiredItems.filter((item) => {
    const artifact = evidence.items.find((a: StageGateArtifact) => a.checklistId === item.id);
    return !artifact || artifact.status !== "passed";
  });

  if (missing.length > 0) {
    const missingDescriptions = missing.map((item) => item.description).join("; ");
    logger.warn(`Stage ${activeStage.type} (#${activeStage.sequence}) has ${missing.length} unresolved required gate items: ${missingDescriptions}`);
  }
}
