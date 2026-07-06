import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort, StageAuditRecord } from "@domain/issue/port";
import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";
import type { SnailPort } from "@domain/snail/port";
import type { SnailFirstCallRequest, SnailResumeRequest } from "@domain/snail/model";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { AgentEvent, InvokeOptions } from "@infra/acs/model";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { CollaborationConsumer, CollaborationInput, CreateIssueResult, DecisionMode, EvaluationResult, SignalType, StageTransitionSuggestion, WorkspaceConsumer } from "@app/issue-collaboration/port";
import type { StageSuggestionRepository, StageSuggestionRecord } from "@domain/issue/_internal/repository";
import { AutoAdvanceEngine } from "@app/issue-collaboration/auto-advance";
import { validateSingleSignal } from "@app/issue-collaboration/signal-validation";
import { ConsumerNotifier } from "@app/issue-collaboration/consumer-notifier";
import { MessageHandler } from "@app/issue-collaboration/message-handler";
import { CollaborationHelpers } from "@app/issue-collaboration/helpers";
import { cleanupResources, type CleanupResult } from "@app/issue-collaboration/resource-cleanup";
import { isStageReEntry } from "@domain/issue/_internal/stage-chain";
import { StageTransitionSignalParser } from "@app/issue-collaboration/_internal/signal-parser";
import { SystemPromptBuilder } from "@app/issue-collaboration/_internal/system-prompt-builder";
import { CONTEXT_KEYS } from "@infra/acs/context-keys";
import { getLogger } from "@infra/logger";
const log = getLogger({ module: "collaboration" });
const truncateForUI = (text: string, maxLen = 200) => text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
interface CollaborationDeps {
  issuePort: IssuePort;
  createIssue: (input: CreateIssueInput) => Issue;
  stagePort: StagePort;
  messagePort: MessagePort;
  snailPort: SnailPort;
  liteAIPort: LiteAIPort;
  mcpMessageStore: McpMessageStore;
  stageSuggestionRepo: StageSuggestionRepository;
  maxCollaborationRounds?: number;
  userCallRateLimitMs?: number;
}
type SpeakerTarget = { speaker: string; source: "mention" | "reply" | "default" };
type DispatchState = { status: "idle" | "invoking"; pending: boolean };
export class IssueCollaboration implements CollaborationInput {
  private readonly issueConsumers = new Map<string, Set<CollaborationConsumer>>();
  private readonly workspaceConsumers = new Map<string, Set<WorkspaceConsumer>>();
  private readonly lastActivityStatus = new Map<string, "ai_running" | "needs_human" | "completed">();
  private readonly suggestions = new Map<string, StageTransitionSuggestion[]>();
  private readonly maxCollaborationRounds: number;
  private readonly activeInvocations = new Map<number, AbortController>();
  private readonly autoAdvanceEngine: AutoAdvanceEngine;
  private readonly consumerNotifier: ConsumerNotifier;
  private readonly messageHandler: MessageHandler;
  private readonly helpers: CollaborationHelpers;
  private readonly signalParser: StageTransitionSignalParser;
  private readonly systemPromptBuilder: SystemPromptBuilder;
  private readonly dispatchStates = new Map<string, DispatchState>();
  private readonly lastUserCallAt = new Map<string, number>();
  private readonly userCallRateLimitMs: number;
  constructor(private readonly deps: CollaborationDeps) {
    this.maxCollaborationRounds = deps.maxCollaborationRounds ?? 30;
    this.userCallRateLimitMs = deps.userCallRateLimitMs ?? 30_000;
    this.consumerNotifier = new ConsumerNotifier();
    this.helpers = new CollaborationHelpers(deps.issuePort, deps.stagePort, deps.messagePort);
    this.messageHandler = new MessageHandler({
      getContext: (messageId) => this.deps.messagePort.getContext(messageId)
    });
    this.autoAdvanceEngine = new AutoAdvanceEngine({
      advanceStage: (stageId, targetKey) => this.advanceStage(stageId, targetKey),
      recordAuditTrail: (fromStage, toStage, suggestion) => this.recordAuditTrail(fromStage, toStage, suggestion),
      notifyConsumers: (stageId, method, ...args) => this.notifyConsumers(stageId, method as keyof CollaborationConsumer, ...args),
      generateDisagreementCard: (stageId, suggestion) => this.generateDisagreementCard(stageId, suggestion),
      mustGetIssue: (issueId) => this.helpers.mustGetIssue(issueId)
    });
    this.signalParser = new StageTransitionSignalParser({
      messagePort: this.deps.messagePort,
    });
    this.systemPromptBuilder = new SystemPromptBuilder({
      messagePort: this.deps.messagePort,
      snailPort: this.deps.snailPort,
      stagePort: this.deps.stagePort,
    });
  }
  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    return this.deps.stagePort.transaction(() => {
      const issue = this.deps.createIssue(input);
      const stage = this.helpers.createInitialStage(issue);
      this.autoInvokeFirstStage(stage, input);
      return { issue, stage };
    });
  }
  async interruptMessage(messageId: number): Promise<boolean> {
    const controller = this.activeInvocations.get(messageId);
    if (!controller) {
      /** 兜底收敛：无活跃 AbortController 但消息仍为 streaming 的孤儿消息 */
      const message = this.deps.messagePort.getMessage(messageId);
      if (!message || message.status !== "streaming") return false;
      const context = this.extractTerminalContext(messageId, "interrupted", "进程已退出");
      this.deps.messagePort.setContext(messageId, context.kind, context.context);
      this.deps.messagePort.completeMessage(messageId, "interrupted");
      try {
        await this.notifyConsumers(message.stage_id, "onMessageCompleted", this.helpers.mustGetMessage(messageId), this.deps.messagePort.getContext(messageId));
      } catch (error) {
        log.error({ messageId, stageId: message.stage_id, err: error }, "interruptMessage notifyConsumers failed");
      }
      log.info({ messageId, stageId: message.stage_id }, "interruptMessage (orphan fallback)");
      return true;
    }
    controller.abort();
    log.info({ messageId }, "interruptMessage");
    return true;
  }
  async sendMessage(stageId: string, text: string, fromSpeaker = "user", toSpeakers?: string[]): Promise<void> {
    const stage = this.helpers.mustGetStage(stageId);
    this.helpers.assertIssueOpen(stage.issue_id);
    const message = this.deps.messagePort.createMessage({ stage_id: stageId, from_speaker: fromSpeaker, to_speakers: [], status: "completed" });
    this.deps.messagePort.setContext(message.id, "final_text", text);
    void this.sendMessageAsync(stageId, stage, message, text, fromSpeaker, toSpeakers).catch((error) => {
      log.error({ stageId, messageId: message.id, err: error }, "sendMessage: async chain failed");
    });
  }
  private async sendMessageAsync(stageId: string, stage: Stage, message: Message, text: string, fromSpeaker: string, toSpeakers?: string[]): Promise<void> {
    const targets: SpeakerTarget[] = toSpeakers && toSpeakers.length > 0
      ? toSpeakers.map(speaker => ({ speaker, source: "mention" as const }))
      : await this.resolveToSpeakers(stage, text, fromSpeaker);
    log.info({ stageId, fromSpeaker, targets: targets.map(t => `${t.speaker}(${t.source})`) }, "sendMessage.targets");
    if (targets.length > 0) this.deps.messagePort.updateMessageTargets(message.id, targets.map(t => t.speaker));
    /** system 消息（from_speaker falsy）需 text event 确保 UI 可渲染（ChatMessage 从 events 提取文本） */
    if (!fromSpeaker) this.deps.messagePort.appendEvent(message.id, { type: "text", text });
    const updatedMessage = this.helpers.mustGetMessage(message.id);
    try {
      await this.notifyConsumers(stageId, "onMessageCompleted", updatedMessage, this.deps.messagePort.getContext(message.id));
    } catch (err) {
      log.warn({ stageId, messageId: message.id, err }, "sendMessage: notifyConsumers failed, continuing to route");
    }
    await this.route(stageId, updatedMessage);
  }
  registerIssueConsumer(issueId: string, consumer: CollaborationConsumer): void {
    const consumers = this.issueConsumers.get(issueId) ?? new Set<CollaborationConsumer>(); consumers.add(consumer); this.issueConsumers.set(issueId, consumers);
  }
  unregisterIssueConsumer(issueId: string, consumer: CollaborationConsumer): void {
    const consumers = this.issueConsumers.get(issueId); if (!consumers) return; consumers.delete(consumer); if (consumers.size === 0) this.issueConsumers.delete(issueId);
  }
  registerWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void {
    const consumers = this.workspaceConsumers.get(workspaceId) ?? new Set<WorkspaceConsumer>(); consumers.add(consumer); this.workspaceConsumers.set(workspaceId, consumers);
  }
  unregisterWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void {
    const consumers = this.workspaceConsumers.get(workspaceId); if (!consumers) return; consumers.delete(consumer); if (consumers.size === 0) this.workspaceConsumers.delete(workspaceId);
  }
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[] {
    const suggestions = this.suggestions.get(stageId) ?? [];
    const seen = new Set<string>();
    return suggestions.filter(s => { if (seen.has(s.target_key)) return false; seen.add(s.target_key); return true; })
      .map(s => { const c = this.deps.stageSuggestionRepo.countIgnoredByStageAndTargetKey(stageId, s.target_key); return c > 0 ? { ...s, dismiss_count: c } : s; });
  }
  dismissSuggestion(stageId: string, targetKey: string, createdAt: string): boolean {
    const suggestions = this.suggestions.get(stageId); if (!suggestions) return false;
    const remaining = suggestions.filter(s => !(s.target_key === targetKey && s.created_at === createdAt));
    if (remaining.length === suggestions.length) return false;
    for (const s of suggestions) { if (s.target_key === targetKey && s.created_at === createdAt) this.deps.stageSuggestionRepo.markProcessed(s.message_id.toString(), "ignored"); }
    if (remaining.length === 0) this.suggestions.delete(stageId); else this.suggestions.set(stageId, remaining);
    return true;
  }
  async advanceStage(stageId: string, targetKey: string, userHint?: string): Promise<Stage> {
    const oldStage = this.deps.stagePort.findStage(stageId);
    /** 在清除 suggestions 之前提取反向转移的打回原因和证据 */
    const backwardContext = oldStage ? this.extractBackwardContext(stageId, targetKey) : null;
    /** 在创建新 stage 之前判断是否反向转移：此时 listStages 不含即将创建的新 stage，
     * 避免新创建的 stage（left_at=null）被误判为"可重新激活的已存在 stage"。
     * append-only 模型下已离开的 stage 必有 left_at，因此此检查对所有转移返回 false。
     * 完整反向检测依赖 transferStage 实现（F20260703jh7v 遗留项）。 */
    const isBackward = oldStage && this.isBackwardTarget(oldStage.issue_id, targetKey);
    const stage = this.deps.stagePort.advanceStage(stageId, targetKey);
    this.cleanupDispatchStates(stageId);
    for (const s of (this.suggestions.get(stageId) ?? [])) this.deps.stageSuggestionRepo.markProcessed(s.message_id.toString(), "confirmed");
    this.suggestions.delete(stageId);
    this.helpers.initStageCursors(stage);
    if (isBackward) this.autoInvokeBackwardStage(stage, oldStage, backwardContext, userHint);
    else this.autoInvokeNewStage(stage, userHint);
    return stage;
  }
  /** 用户强制推进：跳过引擎阻断，执行推进并写审计日志 */
  async forceAdvance(stageId: string, targetKey: string, userHint?: string): Promise<{ stage: Stage; evaluation: EvaluationResult }> {
    this.helpers.mustGetStage(stageId);
    /** 仍然执行评估，获取阻断原因供前端展示。评估失败不阻塞强制推进。 */
    let evaluation: EvaluationResult;
    try {
      evaluation = await this.evaluateAdvance(stageId);
    } catch (err) {
      log.error({ stageId, err }, "force advance: evaluateAdvance failed, proceeding with empty evaluation");
      evaluation = { action: "blocked", reasons: [{ code: "EVALUATE_FAILED", severity: "error", message: `评估失败：${err instanceof Error ? err.message : String(err)}` }] };
    }
    const oldStage = this.deps.stagePort.findStage(stageId);
    /** 在清除 suggestions 之前提取反向转移的打回原因和证据（与 advanceStage 一致） */
    const backwardContext = oldStage ? this.extractBackwardContext(stageId, targetKey) : null;
    /** 在创建新 stage 之前判断是否反向转移（与 advanceStage 一致的时序修正） */
    const isBackward = oldStage && this.isBackwardTarget(oldStage.issue_id, targetKey);
    const newStage = this.deps.stagePort.advanceStage(stageId, targetKey);
    this.cleanupDispatchStates(stageId);
    for (const s of (this.suggestions.get(stageId) ?? [])) this.deps.stageSuggestionRepo.markProcessed(s.message_id.toString(), "confirmed");
    this.suggestions.delete(stageId);
    this.helpers.initStageCursors(newStage);
    /** 审计日志：标记为 forced，让后续审查者知道这是用户手动强制推进 */
    const reasons = evaluation.reasons.map(r => r.code).join(", ");
    this.deps.stagePort.recordAudit({
      stage_id: stageId, from_key: oldStage?.key ?? "", to_key: newStage.key,
      trigger: "manual", trigger_reason: `[forced] 用户强制推进，绕过阻断：${reasons}`,
      consensus_content: "", timestamp: Date.now(),
    });
    log.warn({ stageId, targetKey, reasons }, "force advance: user bypassed engine block");
    /** 通知消费者（与自动推进一致） */
    await this.notifyConsumers(newStage.id, "onAutoAdvanced", {
      from: stageId, to: newStage.id, from_key: oldStage?.key ?? "", to_key: newStage.key, reason: `[forced] 用户强制推进`,
    });
    if (isBackward) {
      this.autoInvokeBackwardStage(newStage, oldStage, backwardContext ?? { reason: `[forced] 用户强制推进`, gate_evidence: {} }, userHint);
    } else {
      this.autoInvokeNewStage(newStage, userHint);
    }
    return { stage: newStage, evaluation };
  }
  /** 在 suggestions 被清除前提取打回原因和证据 */
  private extractBackwardContext(fromStageId: string, targetKey: string): { reason: string; gate_evidence?: Record<string, unknown> } | null {
    const s = (this.suggestions.get(fromStageId) ?? []).find(s => s.target_key === targetKey);
    if (!s) return null;
    return { reason: s.reason, gate_evidence: s.gate_evidence };
  }
  /** 判断 targetKey 是否为反向目标（在 stage 历史中存在未离开的实例） */
  private isBackwardTarget(issueId: string, targetKey: string): boolean {
    const stages = this.deps.stagePort.listStages(issueId) ?? [];
    return stages.some(s => s.key === targetKey && !s.left_at);
  }
  /** L2: 手动推进前的引擎评估（不执行自动推进）。内存缓存为空时从 DB 回读 */
  async evaluateAdvance(stageId: string): Promise<EvaluationResult> {
    const stage = this.helpers.mustGetStage(stageId);
    let suggestions = this.suggestions.get(stageId);
    if (!suggestions?.length) {
      const pending = this.deps.stageSuggestionRepo.listPendingByStage(stageId);
      if (pending.length) { this.restoreSuggestions(stageId, pending); suggestions = this.suggestions.get(stageId); }
    }
    return this.autoAdvanceEngine.evaluateAdvance(stage, suggestions ?? []);
  }
  async closeIssue(issueId: string): Promise<{ issue: Issue; cleanup: CleanupResult }> {
    const existingIssue = this.deps.issuePort.findIssue(issueId);
    if (existingIssue?.closed_at) {
      this.notifyWorkspaceClose(issueId, existingIssue.workspace_path);
      const cleanup: CleanupResult = existingIssue.close_summary as CleanupResult ?? { pr: { status: "skipped" }, worktree: { status: "skipped" }, localBranch: { status: "skipped" }, remoteBranch: { status: "skipped" } };
      return { issue: existingIssue, cleanup };
    }
    const issue = this.deps.issuePort.closeIssue(issueId);
    this.notifyWorkspaceClose(issueId, issue.workspace_path);
    this.cleanupResourcesAsync(issueId, issue.context, issue.workspace_path).catch((err) => { log.error({ issueId, err }, "closeIssue: cleanupResourcesAsync unhandled rejection"); });
    const pending = { pr: { status: "pending" }, worktree: { status: "pending" }, localBranch: { status: "pending" }, remoteBranch: { status: "pending" } };
    return { issue, cleanup: pending as unknown as CleanupResult };
  }
  private notifyWorkspaceClose(issueId: string, workspacePath: string): void {
    const prevStatus = this.lastActivityStatus.get(issueId) ?? "needs_human";
    this.lastActivityStatus.delete(issueId);
    for (const c of this.workspaceConsumers.get(workspacePath) ?? []) c.onActivityStatusChanged(issueId, "completed", prevStatus);
  }
  private async cleanupResourcesAsync(issueId: string, context: Record<string, string>, workspacePath: string): Promise<void> {
    let cleanup: CleanupResult | undefined;
    try { cleanup = await cleanupResources(context, workspacePath); } catch (err) {
      log.error({ issueId, err }, "cleanupResourcesAsync failed");
      cleanup = { pr: { status: "failed", error: String(err) }, worktree: { status: "failed", error: String(err) }, localBranch: { status: "failed", error: String(err) }, remoteBranch: { status: "failed", error: String(err) } };
    }
    try { this.deps.issuePort.updateCloseSummary(issueId, cleanup); } catch (err) { log.error({ issueId, err }, "closeIssue: updateCloseSummary failed"); }
    this.notifyCleanupCompleted(issueId, cleanup);
  }
  private notifyCleanupCompleted(issueId: string, cleanup: CleanupResult): void {
    for (const c of this.issueConsumers.get(issueId) ?? []) { try { c.onCleanupCompleted?.(issueId, cleanup); } catch (err) { log.warn({ issueId, err }, "notifyCleanupCompleted failed"); } }
  }
  async resumeRoute(stageId: string, message: Message): Promise<void> {
    try {
      await this.route(stageId, message);
    } catch (error) {
      log.error({ stageId, messageId: message.id, err: error }, "resumeRoute failed");
    }
  }
  isInvoking(stageId: string): boolean {
    for (const [key, state] of this.dispatchStates) { if (key.startsWith(`${stageId}:`) && state.status === "invoking") return true; }
    return false;
  }
  getActivityStatus(stageId: string, issueClosedAt?: string | null): "ai_running" | "needs_human" | "completed" {
    if (issueClosedAt) return "completed";
    if (this.isInvoking(stageId)) return "ai_running";
    const latest = this.deps.messagePort.findLatestMessage(stageId);
    if (latest?.status === "streaming") return "ai_running";
    return "needs_human";
  }
  private cleanupDispatchStates(stageId: string): void {
    const prefix = `${stageId}:`;
    for (const key of this.dispatchStates.keys()) { if (key.startsWith(prefix)) this.dispatchStates.delete(key); }
  }
  private async route(stageId: string, message: Message): Promise<void> {
    const targets = message.to_speakers;
    if (targets.length === 0) return;
    const stage = this.deps.stagePort.findStage(stageId);
    if (!stage || stage.left_at) { this.cleanupDispatchStates(stageId); return; }
    const uniqueTargets = [...new Set(targets)];
    await Promise.all(uniqueTargets.map(speaker => this.dispatch(stageId, speaker)));
  }
  private isUserCallRateLimited(stageId: string): boolean {
    const now = Date.now(), last = this.lastUserCallAt.get(stageId);
    if (last !== undefined && now - last < this.userCallRateLimitMs) { log.debug({ stageId, elapsed: now - last }, "dispatch: user call rate limited"); return true; }
    this.lastUserCallAt.set(stageId, now);
    return false;
  }
  private async dispatch(stageId: string, speaker: string): Promise<void> {
    const key = `${stageId}:${speaker}`;
    if (speaker === "user") {
      if (this.isUserCallRateLimited(stageId)) return;
      const latest = this.deps.messagePort.findLatestMessage(stageId);
      if (latest) await this.notifyConsumers(stageId, "onUserCalled", latest);
      return;
    }
    const existing = this.dispatchStates.get(key);
    if (existing?.status === "invoking") {
      existing.pending = true;
      log.debug({ stageId, speaker }, "dispatch: agent busy, marked pending");
      return;
    }
    this.dispatchStates.set(key, { status: "invoking", pending: true });
    let remainingRounds = this.maxCollaborationRounds;
    try {
      while (remainingRounds > 0) {
        const state = this.dispatchStates.get(key);
        if (!state) return;
        state.pending = false;
        const unread = this.deps.messagePort.getUnreadMessages(stageId, speaker);
        if (unread.length === 0) break;
        await this.invokeAgent(stageId, speaker, unread);
        this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
        if (!this.dispatchStates.get(key)?.pending) break;
        remainingRounds--;
      }
    } finally {
      if (remainingRounds <= 0) log.warn({ stageId, speaker }, "dispatch: max rounds reached");
      this.dispatchStates.set(key, { status: "idle", pending: false });
      this.notifyWorkspaceIfStatusChanged(stageId);
    }
  }
  private async invokeAgent(stageId: string, roleInstance: string, unreadMessages: Message[]): Promise<void> {
    const stage = this.helpers.mustGetStage(stageId);
    const issue = this.helpers.mustGetIssue(stage.issue_id);
    const assignment = this.deps.stagePort.getRoleSnailAssignment(stageId, roleInstance);
    if (!assignment) throw new Error(`Role assignment not found: ${stageId}:${roleInstance}`);
    log.info({ stageId, roleInstance, snailKey: assignment.snail_key, snailInstanceId: assignment.snail_instance_id, unreadCount: unreadMessages.length, issueId: issue.id }, "invokeAgent start");
    const agentMessage = this.deps.messagePort.createMessage({
      stage_id: stageId, from_speaker: roleInstance, to_speakers: [], status: "streaming",
    });
    await this.notifyConsumers(stageId, "onMessageStarted", agentMessage);
    const abortController = new AbortController();
    this.activeInvocations.set(agentMessage.id, abortController);
    try {
      const result = await this.executeAgentInvocation({ stageId, roleInstance, issue, stage, assignment, unreadMessages, agentMessage, signal: abortController.signal });
      if (result.snail_instance_id && result.snail_instance_id !== assignment.snail_instance_id) {
        this.deps.stagePort.setSnailInstanceId(stageId, roleInstance, result.snail_instance_id);
      }
      const targets = this.resolveReplies(stage, roleInstance, agentMessage.id);
      this.deps.messagePort.updateMessageTargets(agentMessage.id, targets);
      const context = this.extractTerminalContext(agentMessage.id, "completed");
      this.deps.messagePort.setContext(agentMessage.id, context.kind, context.context);
      this.deps.messagePort.completeMessage(agentMessage.id, "completed");
      const completedMessage = this.helpers.mustGetMessage(agentMessage.id);
      log.info({ stageId, roleInstance, messageId: agentMessage.id, contextKind: context.kind, targets }, "invokeAgent completed");
      await this.detectStageTransition(stage, roleInstance, completedMessage.id);
      await this.notifyConsumers(stageId, "onMessageCompleted", completedMessage, this.deps.messagePort.getContext(completedMessage.id));
      try {
        await this.route(stageId, completedMessage);
      } catch (routeError) {
        log.error({ stageId, roleInstance, err: routeError }, "route after invokeAgent failed");
      }
    } catch (error) {
      this.deps.mcpMessageStore.deleteMcpRoutingTargets(agentMessage.id);
      log.error({ stageId, roleInstance, issueId: issue.id, snailKey: assignment.snail_key, snailInstanceId: assignment.snail_instance_id, err: error }, "invokeAgent failed");
      const status = abortController.signal.aborted ? "interrupted" : "failed";
      const errorReason = error instanceof Error ? error.message : String(error);
      const ctx = this.extractTerminalContext(agentMessage.id, status, truncateForUI(errorReason));
      this.deps.messagePort.setContext(agentMessage.id, ctx.kind, ctx.context);
      this.deps.messagePort.completeMessage(agentMessage.id, status, { error: errorReason });
      await this.notifyConsumers(stageId, "onMessageCompleted", this.helpers.mustGetMessage(agentMessage.id), this.deps.messagePort.getContext(agentMessage.id));
      throw error;
    } finally {
      this.activeInvocations.delete(agentMessage.id);
    }
  }
  private async executeAgentInvocation(input: { stageId: string; roleInstance: string; issue: Issue; stage: Stage; assignment: { snail_key: string; snail_instance_id: string | null; role_key: string }; unreadMessages: Message[]; agentMessage: Message; signal?: AbortSignal }) {
    const { stageId, roleInstance, issue, stage, assignment, unreadMessages, agentMessage, signal } = input;
    const systemReminder = this.buildSystemReminder({ issue, stage, roleInstance, roleKey: assignment.role_key, snailKey: assignment.snail_key });
    const invokeOptions: InvokeOptions = { signal }; const agentMessages = unreadMessages.map(message => this.messageHandler.toAgentMessage(message));
    const firstCallRequest = {
      workspace_path: issue.workspace_path, messages: agentMessages, systemReminder: systemReminder || undefined,
      context: { [CONTEXT_KEYS.ISSUE_ID]: issue.id, [CONTEXT_KEYS.STAGE_ID]: stage.id, stage_key: stage.key, role_instance: roleInstance, ...issue.context, snail_key: assignment.snail_key },
    };
    const resumeRequest = { workspace_path: issue.workspace_path, messages: agentMessages, system_reminder: systemReminder, messageId: String(agentMessage.id), stageId: stage.id }; const onEvent = (event: AgentEvent) => this.handleAgentEvent(stageId, agentMessage.id, event);
    return assignment.snail_instance_id
      ? await this.invokeResumeOrRecover({ stageId, roleInstance, snailInstanceId: assignment.snail_instance_id, snailKey: assignment.snail_key, resumeRequest, firstCallRequest, onEvent, invokeOptions })
      : await this.deps.snailPort.invokeFirstCall(assignment.snail_key, firstCallRequest, onEvent, invokeOptions);
  }
  private async invokeResumeOrRecover(input: { stageId: string; roleInstance: string; snailInstanceId: string; snailKey: string; resumeRequest: SnailResumeRequest; firstCallRequest: SnailFirstCallRequest; onEvent: (event: AgentEvent) => void; invokeOptions: InvokeOptions }) {
    try {
      return await this.deps.snailPort.invokeResume(input.snailInstanceId, input.resumeRequest, input.onEvent, input.invokeOptions);
    } catch (error) {
      if (!(error instanceof Error && error.message === `Snail instance not found: ${input.snailInstanceId}`)) throw error;
      log.warn({ snailInstanceId: input.snailInstanceId, snailKey: input.snailKey, stageId: input.stageId }, "invokeResume.instance_missing.fallback");
      const result = await this.deps.snailPort.invokeFirstCall(input.snailKey, input.firstCallRequest, input.onEvent, input.invokeOptions);
      this.deps.stagePort.setSnailInstanceId(input.stageId, input.roleInstance, result.snail_instance_id);
      return result;
    }
  }
  private handleAgentEvent(stageId: string, messageId: number, event: AgentEvent): void {
    const payload = this.messageHandler.mapAgentEvent(event); const appended = this.deps.messagePort.appendEvent(messageId, payload);
    void this.notifyConsumers(stageId, "onEvent", appended).catch((err) => { log.warn({ stageId, messageId, err }, "handleAgentEvent notifyConsumers failed"); });
  }
  private resolveReplies(stage: Stage, roleInstance: string, messageId: number): string[] {
    /** 优先级 1: MCP to_speakers（agent 通过 set_final_body 显式声明）；优先级 2: signal mentions + text @mentions */
    const mcpTargets = this.deps.mcpMessageStore.getMcpRoutingTargets(messageId);
    if (mcpTargets && mcpTargets.length > 0) {
      this.deps.mcpMessageStore.deleteMcpRoutingTargets(messageId);
      return mcpTargets.filter(mention => this.isValidReplyMention(stage, roleInstance, mention));
    }
    const mentions = new Set<string>();
    for (const event of this.deps.messagePort.getMessageEvents(messageId))
      for (const mention of this.getEventMentions(event))
        if (this.isValidReplyMention(stage, roleInstance, mention)) mentions.add(mention);
    return [...mentions];
  }
  private getEventMentions(event: MessageEvent): string[] {
    if (event.payload.type === "text") return this.extractMentions(event.payload.text);
    if (event.payload.type !== "signal" || !Array.isArray(event.payload.mentions)) return [];
    return event.payload.mentions.filter((mention): mention is string => typeof mention === "string");
  }
  private isValidReplyMention(stage: Stage, roleInstance: string, mention: string): boolean {
    return mention === "user" || (mention !== roleInstance && stage.role_instances.includes(mention));
  }
  private async detectStageTransition(stage: Stage, roleInstance: string, messageId: number): Promise<void> {
    const suggestion = this.signalParser.extract(stage, roleInstance, messageId);
    if (!suggestion) return;
    /** L1 信号拦截：单条信号校验（decision_mode、context、gate、artifact、blocking_rules），不持久化阻断信号 */
    const typedSuggestion = {
      ...suggestion,
      signal_type: suggestion.signal_type ?? this.autoAdvanceEngine.inferSignalType(suggestion, stage.key),
      decision_mode: suggestion.decision_mode ?? "autonomous",
    };
    const issue = this.deps.issuePort.findIssue(stage.issue_id);
    const config = issue?.sop_snapshot?.stage_definitions?.find(d => d.key === stage.key)?.auto_advance;
    const l1Result = validateSingleSignal(stage, typedSuggestion, config, issue?.context ?? {});
    if (l1Result && l1Result.action === "blocked") {
      log.warn({ stageId: stage.id, roleInstance, messageId, codes: l1Result.reasons.map(r => r.code) }, "L1: signal blocked by validation");
      await this.notifyConsumers(stage.id, "onEvaluationResult", l1Result);
      return;
    }
    this.persistSuggestion(suggestion);
    const suggestions = this.suggestions.get(stage.id) ?? [];
    suggestions.push(suggestion);
    this.suggestions.set(stage.id, suggestions);
    await this.notifyConsumers(stage.id, "onStageTransitionSuggested", suggestion);
    const result = await this.autoAdvanceEngine.evaluate(stage, suggestions);
    await this.notifyConsumers(stage.id, "onEvaluationResult", result);
  }
  private async recordAuditTrail(fromStage: Stage, toStage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
    this.deps.stagePort.recordAudit({ stage_id: fromStage.id, from_key: fromStage.key, to_key: toStage.key, trigger: "auto", trigger_reason: suggestion.reason, consensus_content: suggestion.guard ?? "", timestamp: Date.now() });
  }
  private async generateDisagreementCard(stageId: string, suggestion: StageTransitionSuggestion): Promise<void> {
    const options = (suggestion.positions ?? []).map(p => ({ label: `${p.speaker}: ${p.stance}`, description: p.argument }));
    await this.notifyConsumers(stageId, "onDisagreement", { ...suggestion, question: { text: suggestion.reason, options } });
  }
  private persistSuggestion(s: StageTransitionSuggestion): void {
    this.deps.stageSuggestionRepo.insert({ id: s.message_id.toString(), stage_id: s.stage_id, target_key: s.target_key, signal_type: s.signal_type ?? null,
      gate_evidence: s.gate_evidence ? JSON.stringify(s.gate_evidence) : null, adversarial_artifact: s.adversarial_artifact ? JSON.stringify(s.adversarial_artifact) : null,
      decision_mode: s.decision_mode ?? null, recommendation: s.recommendation ?? null, alternatives: s.alternatives ? JSON.stringify(s.alternatives) : null, status: "pending", created_at: Date.now(), processed_at: null });
  }
  restoreSuggestions(stageId: string, records: StageSuggestionRecord[]): void {
    if (records.length === 0) return;
    this.suggestions.set(stageId, records.map(r => ({ stage_id: r.stage_id, message_id: parseInt(r.id, 10), from_speaker: "recovered", target_key: r.target_key,
      reason: "", guard: null, artifacts: {}, created_at: new Date(r.created_at).toISOString(), signal_type: r.signal_type as SignalType | undefined,
      gate_evidence: r.gate_evidence ? JSON.parse(r.gate_evidence) : undefined, adversarial_artifact: r.adversarial_artifact ? JSON.parse(r.adversarial_artifact) : undefined,
      decision_mode: r.decision_mode as DecisionMode | undefined, recommendation: r.recommendation ?? undefined,
      alternatives: r.alternatives ? JSON.parse(r.alternatives) as string[] : undefined })));
  }
  async rollbackStage(stageId: string, targetKey: string, userHint?: string): Promise<Stage> {
    return this.advanceStage(stageId, targetKey, userHint);
  }
  /** 阶段推进后自动向新阶段发送 kickoff 消息，触发默认 agent 开始工作 */
  private autoInvokeNewStage(stage: Stage, userHint?: string): void {
    if (!stage.default_role_instance) return;
    /** 用户提供了 hint，作为用户消息发送（优先于默认 kickoff 和重新进入提示） */
    const hint = userHint?.trim();
    if (hint) {
      this.sendMessage(stage.id, hint, "user").catch((err) => {
        log.error({ stageId: stage.id, err }, "autoInvokeNewStage failed");
      });
      return;
    }
    const reEntry = isStageReEntry(this.deps.stagePort.listStages(stage.issue_id) ?? [], stage.id);
    const text = reEntry
      ? `重新进入 [${stage.key}] 阶段。请先了解前序阶段的情况和变更，再开始工作。`
      : "开始执行。";
    this.sendMessage(stage.id, text, "").catch((err) => {
      log.error({ stageId: stage.id, err }, "autoInvokeNewStage failed");
    });
  }
  /** 反向转移后，向 reactivated stage 发送包含打回原因的 kickoff 消息 */
  private autoInvokeBackwardStage(stage: Stage, fromStage: Stage, backwardContext: { reason: string; gate_evidence?: Record<string, unknown> } | null, userHint?: string): void {
    if (!stage.default_role_instance) return;
    /** 用户提供了 hint，作为用户消息发送（优先于打回原因 kickoff） */
    const hint = userHint?.trim();
    if (hint) {
      this.sendMessage(stage.id, hint, "user").catch((err) => { log.error({ stageId: stage.id, err }, "autoInvokeBackwardStage failed"); });
      return;
    }
    const reason = backwardContext?.reason ?? "未指定原因";
    const evidence = backwardContext?.gate_evidence ? JSON.stringify(backwardContext.gate_evidence, null, 2) : "无";
    const kickoff = `阶段 ${stage.key} 被重新激活。\n\n打回来源：${fromStage.key} 阶段\n打回原因：${reason}\n下游发现的问题：\n${evidence}\n\n请针对以上问题修复后重新推进。`;
    this.sendMessage(stage.id, kickoff, "").catch((err) => { log.error({ stageId: stage.id, err }, "autoInvokeBackwardStage failed"); });
  }
  /** createIssue 后自动向第一个阶段发送 kickoff 消息，使用 summary 作为用户指令 */
  private autoInvokeFirstStage(stage: Stage, input: CreateIssueInput): void {
    if (!stage.default_role_instance) return;
    const summary = input.summary?.trim();
    const sendMessage = summary ? this.sendMessage(stage.id, summary, "user") : this.sendMessage(stage.id, "开始执行。", "");
    sendMessage.catch((err) => {
      log.error({ stageId: stage.id, err }, "autoInvokeFirstStage failed");
    });
  }
  getStageAuditTrail(stageId: string): StageAuditRecord[] {
    return this.deps.stagePort.getAuditTrail(stageId);
  }
  private async resolveToSpeakers(stage: Stage, text: string, fromSpeaker: string): Promise<SpeakerTarget[]> {
    const mentions = await this.resolveMentions(stage, text, fromSpeaker);
    if (mentions.length > 0) return mentions.map(speaker => ({ speaker, source: "mention" }));
    const latest = this.deps.messagePort.findLatestRespondingSpeaker(stage.id);
    if (latest && latest !== fromSpeaker && stage.role_instances.includes(latest)) return [{ speaker: latest, source: "reply" }];
    return [{ speaker: stage.default_role_instance, source: "default" }];
  }
  private async resolveMentions(stage: Stage, text: string, fromSpeaker: string): Promise<string[]> {
    const directMentions = this.extractMentions(text).filter(m => stage.role_instances.includes(m) && m !== fromSpeaker);
    if (directMentions.length > 0 || !this.deps.liteAIPort.getConfig()) return directMentions;
    try {
      const answer = await this.deps.liteAIPort.chat([
        { role: "system", content: "Extract mentioned role instances from the user message. Return only a JSON array of exact role names." },
        { role: "user", content: `Roles: ${JSON.stringify(stage.role_instances)}\nMessage: ${text}` },
      ], { temperature: 0, max_tokens: 200 });
      const parsed = JSON.parse(answer) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string" && item !== fromSpeaker && stage.role_instances.includes(item));
    } catch (err) {
      log.warn({ err, stageId: stage.id }, "mention.resolve.failed");
      return [];
    }
  }
  private extractMentions(text: string): string[] {
    const result = new Set<string>();
    const matcher = /@([\p{L}\p{N}_-]+)/gu;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) result.add(match[1]);
    return [...result];
  }
  private extractTerminalContext(messageId: number, status: "completed" | "interrupted" | "failed", reason?: string): MessageContext {
    return this.systemPromptBuilder.extractTerminalContext(messageId, status, reason);
  }
  private buildSystemReminder(input: { issue: Issue; stage: Stage; roleInstance: string; roleKey: string; snailKey: string }): string {
    return this.systemPromptBuilder.buildSystemReminder(input);
  }
  private async notifyConsumers(stageId: string, method: keyof CollaborationConsumer, ...args: unknown[]): Promise<void> {
    const stage = this.helpers.mustGetStage(stageId);
    const consumers = this.issueConsumers.get(stage.issue_id) ?? new Set<CollaborationConsumer>();
    await this.consumerNotifier.notifyConsumers(consumers, stageId, method, args);
    this.notifyWorkspaceIfStatusChanged(stageId);
  }
  private notifyWorkspaceIfStatusChanged(stageId: string): void {
    const stage = this.helpers.mustGetStage(stageId);
    const issue = this.deps.issuePort.findIssue(stage.issue_id);
    if (!issue || issue.closed_at) return;
    const newStatus = this.getActivityStatus(stageId, issue.closed_at);
    const prev = this.lastActivityStatus.get(stage.issue_id);
    if (prev === newStatus) return;
    this.lastActivityStatus.set(stage.issue_id, newStatus);
    const wsConsumers = this.workspaceConsumers.get(issue.workspace_path);
    if (wsConsumers) for (const c of wsConsumers) c.onActivityStatusChanged(stage.issue_id, newStatus, prev ?? "needs_human");
  }
}
