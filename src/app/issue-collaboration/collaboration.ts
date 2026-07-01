import type { Message, MessageContext, MessageEvent } from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort, StageAuditRecord } from "@domain/issue/port";
import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";
import type { RoleDefinition } from "@domain/sop/model";
import type { SnailPort } from "@domain/snail/port";
import type { SnailFirstCallRequest, SnailResumeRequest } from "@domain/snail/model";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { AgentEvent, InvokeOptions } from "@infra/acs/model";
import type { McpMessageStore } from "@domain/snail-mcp-server/_internal/mcp-message-store";
import type { AdversarialArtifact, CollaborationConsumer, CollaborationInput, CreateIssueResult, DecisionMode, Position, SignalType, StageTransitionSuggestion, WorkspaceConsumer } from "@app/issue-collaboration/port";
import type { StageSuggestionRepository, StageSuggestionRecord } from "@domain/issue/_internal/repository";
import { AutoAdvanceEngine } from "@app/issue-collaboration/auto-advance";
import { ConsumerNotifier } from "@app/issue-collaboration/consumer-notifier";
import { MessageHandler } from "@app/issue-collaboration/message-handler";
import { CollaborationHelpers } from "@app/issue-collaboration/helpers";
import { cleanupResources, resolveContextValue, type CleanupResult } from "@app/issue-collaboration/resource-cleanup";
import { buildIdentityBlock } from "@app/issue-collaboration/_internal/identity-block";
import { CONTEXT_KEYS } from "@infra/acs/context-keys";
import { getLogger } from "@infra/logger";
const log = getLogger({ module: "collaboration" });
const truncateForUI = (text: string, maxLen = 200) => text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
/** 检测 format=blocks JSON payload，提取 fallback_text；非 blocks 格式返回 null */
function extractBlocksFallback(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { format?: unknown; fallback_text?: unknown };
    if (parsed?.format === "blocks" && typeof parsed.fallback_text === "string" && parsed.fallback_text.trim()) return parsed.fallback_text;
  } catch { /* 非 JSON，正常回退 */ }
  return null;
}
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
  /** User Call 频率限制阈值（毫秒），默认 30000 */
  userCallRateLimitMs?: number;
}
type SpeakerTarget = { speaker: string; source: "mention" | "reply" | "default" };
type DispatchState = { status: "idle" | "invoking"; pending: boolean };
type TransitionPayload = { targetKey: string; reason: unknown; guard: unknown; signal_type?: SignalType; decision_mode?: DecisionMode; consensus?: boolean; positions?: Position[]; gate_evidence?: Record<string, unknown>; adversarial_artifact?: AdversarialArtifact; recommendation?: string; alternatives?: string[] };
type ParsedTransition = { target_key?: string; reason?: string; guard?: string | null; signal_type?: string; decision_mode?: string; consensus?: boolean; positions?: Position[]; gate_evidence?: Record<string, unknown>; adversarial_artifact?: AdversarialArtifact; recommendation?: string; alternatives?: string[] };
export class IssueCollaboration implements CollaborationInput {
  private readonly issueConsumers = new Map<string, Set<CollaborationConsumer>>();
  private readonly workspaceConsumers = new Map<string, Set<WorkspaceConsumer>>();
  private readonly lastActivityStatus = new Map<string, "ai_running" | "needs_human" | "completed">();
  /** 内存缓存：仅用于当前进程的快速查询，持久化到 DB */
  private readonly suggestions = new Map<string, StageTransitionSuggestion[]>();
  private readonly maxCollaborationRounds: number;
  private readonly activeInvocations = new Map<number, AbortController>();
  private readonly autoAdvanceEngine: AutoAdvanceEngine;
  private readonly consumerNotifier: ConsumerNotifier;
  private readonly messageHandler: MessageHandler;
  private readonly helpers: CollaborationHelpers;
  private readonly dispatchStates = new Map<string, DispatchState>();
  /** User Call 频率限制：per-stage 的上次 user call 时间戳 */
  private readonly lastUserCallAt = new Map<string, number>();
  /** User Call 频率限制阈值（毫秒） */
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
  }
  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    return this.deps.stagePort.transaction(() => {
      const issue = this.deps.createIssue(input);
      const stage = this.helpers.createInitialStage(issue);
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
    const updatedMessage = this.helpers.mustGetMessage(message.id);
    try {
      await this.notifyConsumers(stageId, "onMessageCompleted", updatedMessage, this.deps.messagePort.getContext(message.id));
    } catch (err) {
      log.warn({ stageId, messageId: message.id, err }, "sendMessage: notifyConsumers failed, continuing to route");
    }
    await this.route(stageId, updatedMessage);
  }
  registerIssueConsumer(issueId: string, consumer: CollaborationConsumer): void {
    const consumers = this.issueConsumers.get(issueId) ?? new Set<CollaborationConsumer>();
    consumers.add(consumer);
    this.issueConsumers.set(issueId, consumers);
  }
  unregisterIssueConsumer(issueId: string, consumer: CollaborationConsumer): void {
    const consumers = this.issueConsumers.get(issueId);
    if (!consumers) return;
    consumers.delete(consumer);
    if (consumers.size === 0) this.issueConsumers.delete(issueId);
  }
  registerWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void {
    const consumers = this.workspaceConsumers.get(workspaceId) ?? new Set<WorkspaceConsumer>();
    consumers.add(consumer);
    this.workspaceConsumers.set(workspaceId, consumers);
  }
  unregisterWorkspaceConsumer(workspaceId: string, consumer: WorkspaceConsumer): void {
    const consumers = this.workspaceConsumers.get(workspaceId);
    if (!consumers) return;
    consumers.delete(consumer);
    if (consumers.size === 0) this.workspaceConsumers.delete(workspaceId);
  }
  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[] {
    const suggestions = this.suggestions.get(stageId) ?? [];
    const seen = new Set<string>();
    return suggestions.filter(s => {
      if (seen.has(s.target_key)) return false;
      seen.add(s.target_key);
      return true;
    }).map(s => {
      /** B5：附加该 target_key 被忽略的次数 */
      const dismissCount = this.deps.stageSuggestionRepo.countIgnoredByStageAndTargetKey(stageId, s.target_key);
      return dismissCount > 0 ? { ...s, dismiss_count: dismissCount } : s;
    });
  }
  dismissSuggestion(stageId: string, targetKey: string, createdAt: string): boolean {
    const suggestions = this.suggestions.get(stageId);
    if (!suggestions) return false;
    const remaining = suggestions.filter(s => !(s.target_key === targetKey && s.created_at === createdAt));
    if (remaining.length === suggestions.length) return false;
    /** 标记对应的 DB 记录为 ignored */
    for (const s of suggestions) {
      if (s.target_key === targetKey && s.created_at === createdAt) {
        this.deps.stageSuggestionRepo.markProcessed(s.message_id.toString(), "ignored");
      }
    }
    if (remaining.length === 0) this.suggestions.delete(stageId);
    else this.suggestions.set(stageId, remaining);
    return true;
  }
  async advanceStage(stageId: string, targetKey: string): Promise<Stage> {
    const stage = this.deps.stagePort.advanceStage(stageId, targetKey);
    this.cleanupDispatchStates(stageId);
    /** 标记所有 pending suggestion 为 confirmed */
    for (const s of (this.suggestions.get(stageId) ?? [])) {
      this.deps.stageSuggestionRepo.markProcessed(s.message_id.toString(), "confirmed");
    }
    this.suggestions.delete(stageId);
    this.helpers.initStageCursors(stage);
    return stage;
  }
  async closeIssue(issueId: string): Promise<{ issue: Issue; cleanup: CleanupResult }> {
    const existingIssue = this.deps.issuePort.findIssue(issueId);
    if (existingIssue?.closed_at) {
      const prevStatus = this.lastActivityStatus.get(issueId) ?? "needs_human";
      this.lastActivityStatus.delete(issueId);
      this.broadcastWorkspaceStatus(existingIssue.workspace_path, issueId, "completed", prevStatus);
      const cleanup: CleanupResult = existingIssue.close_summary as CleanupResult ?? { pr: { status: "skipped" }, worktree: { status: "skipped" }, localBranch: { status: "skipped" }, remoteBranch: { status: "skipped" } };
      return { issue: existingIssue, cleanup };
    }
    const issue = this.deps.issuePort.closeIssue(issueId);
    const prevStatus = this.lastActivityStatus.get(issueId) ?? "needs_human";
    this.lastActivityStatus.delete(issueId);
    this.broadcastWorkspaceStatus(issue.workspace_path, issueId, "completed", prevStatus);
    const cleanup = await cleanupResources(issue.context, issue.workspace_path);
    try { this.deps.issuePort.updateCloseSummary(issueId, cleanup); } catch (err) { log.error({ issueId, err }, "closeIssue: updateCloseSummary failed"); }
    return { issue, cleanup };
  }
  private broadcastWorkspaceStatus(workspacePath: string, issueId: string, status: "ai_running" | "needs_human" | "completed", prevStatus: string): void {
    const consumers = this.workspaceConsumers.get(workspacePath);
    if (consumers) for (const c of consumers) c.onActivityStatusChanged(issueId, status, prevStatus as "ai_running" | "needs_human" | "completed");
  }
  async resumeRoute(stageId: string, message: Message): Promise<void> {
    try {
      await this.route(stageId, message);
    } catch (error) {
      log.error({ stageId, messageId: message.id, err: error }, "resumeRoute failed");
    }
  }
  isInvoking(stageId: string): boolean {
    for (const [key, state] of this.dispatchStates) {
      if (key.startsWith(`${stageId}:`) && state.status === "invoking") return true;
    }
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
    for (const key of this.dispatchStates.keys()) {
      if (key.startsWith(prefix)) this.dispatchStates.delete(key);
    }
  }
  private async route(stageId: string, message: Message): Promise<void> {
    const targets = message.to_speakers;
    if (targets.length === 0) return;
    const stage = this.deps.stagePort.findStage(stageId);
    if (!stage || stage.left_at) { this.cleanupDispatchStates(stageId); return; }
    const uniqueTargets = [...new Set(targets)];
    await Promise.all(uniqueTargets.map(speaker => this.dispatch(stageId, speaker)));
  }
  /** B4: User Call 频率限制 — 同一 stage 内连续 user call 间隔 < threshold 时跳过通知 */
  private isUserCallRateLimited(stageId: string): boolean {
    const now = Date.now();
    const lastCall = this.lastUserCallAt.get(stageId);
    if (lastCall !== undefined && now - lastCall < this.userCallRateLimitMs) {
      log.debug({ stageId, elapsed: now - lastCall }, "dispatch: user call rate limited");
      return true;
    }
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
    while (remainingRounds > 0) {
      const state = this.dispatchStates.get(key);
      if (!state) return;
      state.pending = false;
      const unread = this.deps.messagePort.getUnreadMessages(stageId, speaker);
      if (unread.length === 0) {
        this.dispatchStates.set(key, { status: "idle", pending: false });
        return;
      }
      try {
        await this.invokeAgent(stageId, speaker, unread);
        this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
      } catch {
        // 不推进 cursor，保留 unread 消息供下次 dispatch 重试。
        // 立即退出循环，避免在同一组失败消息上烧尽 maxCollaborationRounds。
        this.dispatchStates.set(key, { status: "idle", pending: false });
        return;
      }
      const current = this.dispatchStates.get(key);
      if (!current) return;
      if (!current.pending) {
        this.dispatchStates.set(key, { status: "idle", pending: false });
        return;
      }
      remainingRounds--;
    }
    log.warn({ stageId, speaker }, "dispatch: max rounds reached");
    this.dispatchStates.set(key, { status: "idle", pending: false });
  }
  private async invokeAgent(stageId: string, roleInstance: string, unreadMessages: Message[]): Promise<void> {
    const stage = this.helpers.mustGetStage(stageId);
    const issue = this.helpers.mustGetIssue(stage.issue_id);
    const assignment = this.deps.stagePort.getRoleSnailAssignment(stageId, roleInstance);
    if (!assignment) throw new Error(`Role assignment not found: ${stageId}:${roleInstance}`);
    log.info({ stageId, roleInstance, snailKey: assignment.snail_key, snailInstanceId: assignment.snail_instance_id, unreadCount: unreadMessages.length, issueId: issue.id }, "invokeAgent start");
    const agentMessage = this.deps.messagePort.createMessage({ stage_id: stageId, from_speaker: roleInstance, to_speakers: [], status: "streaming" });
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
      try { await this.route(stageId, completedMessage); } catch (routeError) { log.error({ stageId, roleInstance, err: routeError }, "route after invokeAgent failed"); }
    } catch (error) {
      this.deps.mcpMessageStore.deleteMcpRoutingTargets(agentMessage.id);
      log.error({ stageId, roleInstance, issueId: issue.id, snailKey: assignment.snail_key, snailInstanceId: assignment.snail_instance_id, err: error }, "invokeAgent failed");
      const status = abortController.signal.aborted ? "interrupted" : "failed";
      const errorReason = error instanceof Error ? error.message : String(error);
      const context = this.extractTerminalContext(agentMessage.id, status, truncateForUI(errorReason));
      this.deps.messagePort.setContext(agentMessage.id, context.kind, context.context);
      this.deps.messagePort.completeMessage(agentMessage.id, status, { error: errorReason });
      await this.notifyConsumers(stageId, "onMessageCompleted", this.helpers.mustGetMessage(agentMessage.id), this.deps.messagePort.getContext(agentMessage.id));
      throw error;
    } finally { this.activeInvocations.delete(agentMessage.id); }
  }
  private async executeAgentInvocation(input: {
    stageId: string; roleInstance: string; issue: Issue; stage: Stage;
    assignment: { snail_key: string; snail_instance_id: string | null; role_key: string };
    unreadMessages: Message[]; agentMessage: Message; signal?: AbortSignal;
  }) {
    const { stageId, roleInstance, issue, stage, assignment, unreadMessages, agentMessage, signal } = input;
    const systemReminder = this.buildSystemReminder({ issue, stage, roleInstance, roleKey: assignment.role_key, snailKey: assignment.snail_key });
    const agentMessages = unreadMessages.map(m => this.messageHandler.toAgentMessage(m));
    const firstCallRequest = {
      workspace_path: issue.workspace_path, messages: agentMessages, systemReminder: systemReminder || undefined,
      context: { [CONTEXT_KEYS.ISSUE_ID]: issue.id, [CONTEXT_KEYS.STAGE_ID]: stage.id, [CONTEXT_KEYS.MESSAGE_ID]: String(agentMessage.id), stage_key: stage.key, role_instance: roleInstance, ...issue.context, snail_key: assignment.snail_key },
    };
    const resumeRequest = { workspace_path: issue.workspace_path, messages: agentMessages, system_reminder: systemReminder, messageId: String(agentMessage.id), stageId: stage.id };
    const onEvent = (event: AgentEvent) => this.handleAgentEvent(stageId, agentMessage.id, event);
    const invokeOptions: InvokeOptions = { signal };
    return assignment.snail_instance_id
      ? await this.invokeResumeOrRecover({ stageId, roleInstance, snailInstanceId: assignment.snail_instance_id, snailKey: assignment.snail_key, resumeRequest, firstCallRequest, onEvent, invokeOptions })
      : await this.deps.snailPort.invokeFirstCall(assignment.snail_key, firstCallRequest, onEvent, invokeOptions);
  }
  private async invokeResumeOrRecover(input: { stageId: string; roleInstance: string; snailInstanceId: string; snailKey: string; resumeRequest: SnailResumeRequest; firstCallRequest: SnailFirstCallRequest; onEvent: (event: AgentEvent) => void; invokeOptions: InvokeOptions }) {
    try {
      return await this.deps.snailPort.invokeResume(input.snailInstanceId, input.resumeRequest, input.onEvent, input.invokeOptions);
    } catch (error) {
      if (!this.isMissingSnailInstanceError(error, input.snailInstanceId)) throw error;
      log.warn({ snailInstanceId: input.snailInstanceId, snailKey: input.snailKey, stageId: input.stageId }, "invokeResume.instance_missing.fallback");
      const result = await this.deps.snailPort.invokeFirstCall(input.snailKey, input.firstCallRequest, input.onEvent, input.invokeOptions);
      this.deps.stagePort.setSnailInstanceId(input.stageId, input.roleInstance, result.snail_instance_id);
      return result;
    }
  }
  private isMissingSnailInstanceError(error: unknown, snailInstanceId: string): boolean { return error instanceof Error && error.message === `Snail instance not found: ${snailInstanceId}`; }
  private handleAgentEvent(stageId: string, messageId: number, event: AgentEvent): void {
    const payload = this.messageHandler.mapAgentEvent(event);
    const appended = this.deps.messagePort.appendEvent(messageId, payload);
    void this.notifyConsumers(stageId, "onEvent", appended).catch((err) => {
      log.warn({ stageId, messageId, err }, "handleAgentEvent notifyConsumers failed — consumer may miss subsequent events");
    });
  }
  private resolveReplies(stage: Stage, roleInstance: string, messageId: number): string[] {
    /** 优先级 1: MCP to_speakers（agent 通过 set_final_body 显式声明） */
    const mcpTargets = this.deps.mcpMessageStore.getMcpRoutingTargets(messageId);
    if (mcpTargets && mcpTargets.length > 0) {
      /** 消费后清理，防止泄漏 */
      this.deps.mcpMessageStore.deleteMcpRoutingTargets(messageId);
      return mcpTargets.filter(mention => this.isValidReplyMention(stage, roleInstance, mention));
    }
    /** 优先级 2: 现有逻辑（signal mentions + text @mentions） */
    const mentions = new Set<string>();
    for (const event of this.deps.messagePort.getMessageEvents(messageId)) {
      for (const mention of this.getEventMentions(event)) {
        if (this.isValidReplyMention(stage, roleInstance, mention)) mentions.add(mention);
      }
    }
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
    const suggestion = this.extractStageTransitionSuggestion(stage, roleInstance, messageId);
    if (!suggestion) return;
    this.persistSuggestion(suggestion);
    const suggestions = this.suggestions.get(stage.id) ?? [];
    suggestions.push(suggestion);
    this.suggestions.set(stage.id, suggestions);
    await this.notifyConsumers(stage.id, "onStageTransitionSuggested", suggestion);
    const result = await this.autoAdvanceEngine.evaluate(stage, suggestions);
    await this.notifyConsumers(stage.id, "onEvaluationResult", result);
  }

  private persistSuggestion(suggestion: StageTransitionSuggestion): void {
    this.deps.stageSuggestionRepo.insert({
      id: suggestion.message_id.toString(), stage_id: suggestion.stage_id, target_key: suggestion.target_key,
      signal_type: suggestion.signal_type ?? null, gate_evidence: suggestion.gate_evidence ? JSON.stringify(suggestion.gate_evidence) : null,
      adversarial_artifact: suggestion.adversarial_artifact ? JSON.stringify(suggestion.adversarial_artifact) : null,
      status: "pending", created_at: Date.now(), processed_at: null,
    });
  }
  private async recordAuditTrail(fromStage: Stage, toStage: Stage, suggestion: StageTransitionSuggestion): Promise<void> {
    const audit: StageAuditRecord = {
      stage_id: fromStage.id,
      from_key: fromStage.key,
      to_key: toStage.key,
      trigger: "auto",
      trigger_reason: suggestion.reason,
      consensus_content: suggestion.guard ?? "",
      timestamp: Date.now()
    };
    this.deps.stagePort.recordAudit(audit);
  }
  private async generateDisagreementCard(stageId: string, suggestion: StageTransitionSuggestion): Promise<void> {
    const positions = suggestion.positions ?? [];
    const options = positions.map(p => ({
      label: `${p.speaker}: ${p.stance}`,
      description: p.argument
    }));
    await this.notifyConsumers(stageId, "onDisagreement", {
      ...suggestion,
      question: {
        text: suggestion.reason,
        options
      }
    });
  }
  async rollbackStage(stageId: string, targetKey: string): Promise<Stage> {
    const stage = this.deps.stagePort.rollbackStage(stageId, targetKey);
    this.cleanupDispatchStates(stageId);
    this.deps.stageSuggestionRepo.deleteByStage(stageId);
    this.suggestions.delete(stageId);
    this.helpers.initStageCursors(stage);
    return stage;
  }
  /** 启动恢复：从 DB 记录恢复 suggestions 到内存缓存 */
  restoreSuggestions(stageId: string, records: StageSuggestionRecord[]): void {
    if (records.length === 0) return;
    this.suggestions.set(stageId, records.map(r => ({
      stage_id: r.stage_id, message_id: parseInt(r.id, 10), from_speaker: "recovered",
      target_key: r.target_key, reason: "", guard: null, artifacts: {},
      created_at: new Date(r.created_at).toISOString(),
      signal_type: r.signal_type as SignalType | undefined,
      gate_evidence: r.gate_evidence ? JSON.parse(r.gate_evidence) : undefined,
      adversarial_artifact: r.adversarial_artifact ? JSON.parse(r.adversarial_artifact) : undefined,
    })));
  }
  getStageAuditTrail(stageId: string): StageAuditRecord[] {
    return this.deps.stagePort.getAuditTrail(stageId);
  }
  private extractStageTransitionSuggestion(stage: Stage, roleInstance: string, messageId: number): StageTransitionSuggestion | null {
    for (const event of this.deps.messagePort.getMessageEvents(messageId)) {
      const payload = this.extractSignalPayload(event, stage);
      if (payload) return this.makeStageTransitionSuggestion({ stage, roleInstance, messageId, ...payload });
    }
    return null;
  }
  private extractSignalPayload(event: MessageEvent, stage: Stage): TransitionPayload | null {
    if (event.payload.type === "signal" && typeof event.payload.stage_transition === "object" && event.payload.stage_transition) {
      return this.extractFromSignalPayload(event.payload.stage_transition as Record<string, unknown>, stage);
    }
    if (event.payload.type === "text") {
      return this.extractFromTextPayload(event.payload.text, stage);
    }
    return null;
  }
  private extractFromSignalPayload(payload: Record<string, unknown>, stage: Stage): TransitionPayload | null {
    const targetKey = String(payload.target_key ?? payload.to ?? "");
    if (!targetKey || !stage.available_transitions.some(t => t.to === targetKey)) return null;
    return this.buildTransitionPayload(targetKey, payload);
  }
  private extractFromTextPayload(text: string, stage: Stage): TransitionPayload | null {
    const parsed = this.tryParseStageTransition(text);
    if (!parsed?.target_key || !stage.available_transitions.some(t => t.to === parsed.target_key)) return null;
    return this.buildTransitionPayload(parsed.target_key, parsed as Record<string, unknown>);
  }
  /** 从原始 record 中提取 TransitionPayload 的通用逻辑 */
  private buildTransitionPayload(targetKey: string, raw: Record<string, unknown>): TransitionPayload {
    return {
      targetKey, reason: raw.reason, guard: raw.guard,
      signal_type: typeof raw.signal_type === "string" ? raw.signal_type as SignalType : undefined,
      decision_mode: typeof raw.decision_mode === "string" ? raw.decision_mode as DecisionMode : undefined,
      consensus: typeof raw.consensus === "boolean" ? raw.consensus : undefined,
      positions: Array.isArray(raw.positions) ? raw.positions as Position[] : undefined,
      gate_evidence: typeof raw.gate_evidence === "object" ? raw.gate_evidence as Record<string, unknown> : undefined,
      adversarial_artifact: typeof raw.adversarial_artifact === "object" ? raw.adversarial_artifact as AdversarialArtifact : undefined,
      recommendation: typeof raw.recommendation === "string" ? raw.recommendation : undefined,
      alternatives: Array.isArray(raw.alternatives) ? raw.alternatives as string[] : undefined,
    };
  }
  private makeStageTransitionSuggestion(input: { stage: Stage; roleInstance: string; messageId: number } & TransitionPayload): StageTransitionSuggestion {
    const { stage, roleInstance, messageId, targetKey, reason, guard, signal_type, decision_mode, consensus, positions, gate_evidence, adversarial_artifact, recommendation, alternatives } = input;
    const transition = stage.available_transitions.find(t => t.to === targetKey);
    return {
      stage_id: stage.id, message_id: messageId, from_speaker: roleInstance, target_key: targetKey,
      reason: typeof reason === "string" ? reason : "", guard: typeof guard === "string" ? guard : transition?.guard ?? null,
      artifacts: { ...stage.output_artifacts }, created_at: new Date().toISOString(),
      signal_type, decision_mode, consensus, positions, gate_evidence, adversarial_artifact, recommendation, alternatives,
    };
  }
  private tryParseStageTransition(text: string): ParsedTransition | null {
    try {
      const parsed = JSON.parse(text) as { stage_transition?: ParsedTransition };
      return parsed.stage_transition ?? null;
    } catch {
      log.debug({ textLength: text.length }, "stage_transition.parse.skipped");
      return null;
    }
  }
  private async resolveToSpeakers(stage: Stage, text: string, fromSpeaker: string): Promise<SpeakerTarget[]> {
    const mentions = await this.resolveMentions(stage, text, fromSpeaker);
    if (mentions.length > 0) return mentions.map(speaker => ({ speaker, source: "mention" }));
    const latest = this.deps.messagePort.findLatestRespondingSpeaker(stage.id);
    if (latest && latest !== fromSpeaker && stage.role_instances.includes(latest)) {
      return [{ speaker: latest, source: "reply" }];
    }
    return [{ speaker: stage.default_role_instance, source: "default" }];
  }
  private async resolveMentions(stage: Stage, text: string, fromSpeaker: string): Promise<string[]> {
    const directMentions = this.extractMentions(text).filter(mention => stage.role_instances.includes(mention) && mention !== fromSpeaker);
    if (directMentions.length > 0 || !this.deps.liteAIPort.getConfig()) {
      return directMentions;
    }
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
    while ((match = matcher.exec(text)) !== null) {
      result.add(match[1]);
    }
    return [...result];
  }
  private extractTerminalContext(messageId: number, status: "completed" | "interrupted" | "failed", reason?: string): MessageContext {
    const existing = this.deps.messagePort.getContext(messageId);
    if (existing?.kind === "mcp_final_body") return existing;
    const events = this.deps.messagePort.getMessageEvents(messageId);
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.payload.type === "text" && event.payload.text.trim()) {
        /** 检测 format=blocks JSON payload，提取 fallback_text 避免原文泄露 */
        const blocksText = extractBlocksFallback(event.payload.text);
        return { message_id: messageId, kind: "final_text", context: blocksText ?? event.payload.text, created_at: new Date().toISOString() };
      }
    }
    /** 无 text event 也无 mcp_final_body 时返回状态对应的兜底文案，不 dump 原始 event 给用户 */
    const fallback = status === "interrupted"
      ? (reason ? `用户中断了本次回复（${reason}）` : "用户中断了本次回复")
      : status === "failed"
        ? (reason ? `任务执行失败（${reason}）` : "任务执行失败")
        : "（无文本输出）";
    return { message_id: messageId, kind: "event_summary", context: fallback, created_at: new Date().toISOString() };
  }
  private buildSystemReminder(input: { issue: Issue; stage: Stage; roleInstance: string; roleKey: string; snailKey: string }): string {
    const { issue, stage, roleInstance, roleKey, snailKey } = input;
    const stageDef = issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key);
    const roleDef = stageDef?.roles.find(r => r.key === roleKey);
    return [buildIdentityBlock(roleDef?.name ?? roleInstance, roleInstance, roleDef, this.deps.snailPort.findByKey(snailKey)), this.buildContextBlock(issue, stage, roleDef, roleInstance)].join("\n\n");
  }
  private buildContextBlock(issue: Issue, stage: Stage, roleDef: RoleDefinition | undefined, roleInstance: string): string {
    const transitions = stage.available_transitions.map(transition => `- ${transition.to}${transition.guard ? `: ${transition.guard}` : ""}`).join("\n");
    const sharedSkill = issue.sop_snapshot.shared_skill;
    const skillList = [
      sharedSkill ? `- \`${sharedSkill}\` — 共享规则（特性编号、PR签名、证据规则、完成标准）` : null,
      roleDef?.skill ? `- \`${roleDef.skill}\` — ${roleDef.name}工作流程` : null,
    ].filter(Boolean).join("\n");
    /** Issue 上下文：只读视图，Agent 应使用 MCP 工具读写。基础设施字段缺失时标注警告 */
    const missingInfra = ["worktree_path", "branch_name"].filter(f => !resolveContextValue(issue.context, f));
    const ctxLines = Object.entries(issue.context).map(([k, v]) => `- **${k}**: ${v}`).join("\n") || "无";
    const issueContext = missingInfra.length > 0 ? `${ctxLines}\n> ⚠️ 以下基础设施字段未记录：${missingInfra.join(", ")}` : ctxLines;
    const targets = ["user", ...stage.role_instances.filter(i => i !== roleInstance)].map(t => `\`${t}\``).join("、");
    return `<context>\n## 项目上下文\n**Issue**：${issue.title}\n**Issue ID**：${issue.id}\n**工作区**：${issue.workspace_path}\n**Issue 摘要**：${issue.summary ?? "无"}\n## Issue 上下文（只读视图）\n${issueContext}\n> **注意**：这是只读视图。Agent 应使用 MCP 工具 \`set_context\` 和 \`get_context\` 读写 Issue 上下文。Issue 上下文也会通过环境变量 \`SNAIL_CTX_*\` 注入，可通过 \`process.env\` 读取。\n## 当前阶段\n**阶段**：${stage.title} (${stage.key})\n**阶段描述**：${stage.description}\n## 可用 Skills\n${skillList}\n使用 skill tool 触发对应的 skill，获取详细工作流程和规则。\n## 可用流转\n${transitions || "无"}\n## 协作规则\n- 你可以通过 @角色实例 请求其他角色回应\n- 你是当前阶段的守门人，不是推进者。建议 stage_transition 前，必须先完成所在 SKILL.md 中的 Stage Gate 自检并呈现完整证据。\n- 通过信号表达阶段工作结果：signal_type: gate_complete（单人完成）、adversarial_consensus（多人共识）、disagreement（分歧）\n## 最终答复规则\n**必须使用 \`set_final_body\` MCP 设置最终答复**。每次发言结束前必须调用此工具，传入你希望展示给用户的完整 Markdown 内容。调用后本轮发言结束，不得再调用任何其他工具。\n**路由目标声明**：如果需要其他角色继续处理，必须在 \`set_final_body\` 的 \`to_speakers\` 参数中声明目标角色。\n**可用路由目标**：${targets}\n**格式要求**：必须使用上述精确名称。不要使用 snail key（如 claude-code-stateful）、role key（如 designer）或英文翻译（如 architect-1）。\n**必选参数**：调用 \`set_final_body\` 时必须传入 \`message_id\` 和 \`stage_id\`，从环境变量 \`SNAIL_CTX_MESSAGE_ID\` 和 \`SNAIL_CTX_STAGE_ID\` 获取。\n</context>`;
  }
  private async notifyConsumers(stageId: string, method: keyof CollaborationConsumer, ...args: unknown[]): Promise<void> {
    const stage = this.helpers.mustGetStage(stageId);
    const consumers = this.issueConsumers.get(stage.issue_id) ?? new Set<CollaborationConsumer>();
    await this.consumerNotifier.notifyConsumers(consumers, stageId, method, args);
    const issue = this.deps.issuePort.findIssue(stage.issue_id);
    if (!issue || issue.closed_at) return;
    const newStatus = this.getActivityStatus(stageId, issue.closed_at);
    const prev = this.lastActivityStatus.get(stage.issue_id);
    if (prev !== newStatus) {
      this.lastActivityStatus.set(stage.issue_id, newStatus);
      this.broadcastWorkspaceStatus(issue.workspace_path, stage.issue_id, newStatus, prev ?? "needs_human");
    }
  }
}
