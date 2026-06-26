import type { Message, MessageContext, MessageEvent, MessageEventPayload } from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { CreateIssueInput, Issue, Stage } from "@domain/issue/model";
import type { RoleDefinition } from "@domain/sop/model";
import type { SnailPort } from "@domain/snail/port";
import type { SnailFirstCallRequest, SnailResumeRequest } from "@domain/snail/model";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { AgentEvent, Message as AgentMessage, InvokeOptions } from "@infra/acs/model";
import type { CollaborationConsumer, CollaborationInput, CreateIssueResult, StageTransitionSuggestion } from "@app/issue-collaboration/port";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "collaboration" });

interface CollaborationDeps {
  issuePort: IssuePort;
  createIssue: (input: CreateIssueInput) => Issue;
  stagePort: StagePort;
  messagePort: MessagePort;
  snailPort: SnailPort;
  liteAIPort: LiteAIPort;
  maxCollaborationRounds?: number;
}

type SpeakerTarget = {
  speaker: string;
  source: "mention" | "reply" | "default";
};

// ── Router per-speaker dispatch state ─────────────────────────────────

type DispatchStatus = "idle" | "invoking";

interface DispatchState {
  status: DispatchStatus;
  pending: boolean;
}

export class IssueCollaboration implements CollaborationInput {
  private readonly issueConsumers = new Map<string, Set<CollaborationConsumer>>();
  private readonly suggestions = new Map<string, StageTransitionSuggestion[]>();
  private readonly maxCollaborationRounds: number;
  private readonly activeInvocations = new Map<number, AbortController>();

  /** Router per-speaker dispatch state, key = `${stageId}:${speaker}` */
  private readonly dispatchStates = new Map<string, DispatchState>();

  constructor(private readonly deps: CollaborationDeps) {
    this.maxCollaborationRounds = deps.maxCollaborationRounds ?? 30;
  }

  // ── Public API ──────────────────────────────────────────────────────

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    return this.deps.stagePort.transaction(() => {
      const issue = this.deps.createIssue(input);
      const stage = this.createInitialStage(issue);
      return { issue, stage };
    });
  }

  async interruptMessage(messageId: number): Promise<boolean> {
    const controller = this.activeInvocations.get(messageId);
    if (!controller) {
      /** 兜底收敛：无活跃 AbortController 但消息仍为 streaming 的孤儿消息 */
      const message = this.deps.messagePort.getMessage(messageId);
      if (!message || message.status !== "streaming") return false;
      const context = this.extractTerminalContext(messageId, "interrupted");
      this.deps.messagePort.setContext(messageId, context.kind, context.context);
      this.deps.messagePort.completeMessage(messageId, "interrupted");
      try {
        await this.notifyConsumers(message.stage_id, "onMessageCompleted", this.mustGetMessage(messageId), this.deps.messagePort.getContext(messageId));
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
    const stage = this.mustGetStage(stageId);
    this.assertIssueOpen(stage.issue_id);
    /** 前端传入 to_speakers 时直接使用（UI 驱动的精确路由），否则走服务端 fallback 解析 */
    const targets: SpeakerTarget[] = toSpeakers && toSpeakers.length > 0
      ? toSpeakers.map(speaker => ({ speaker, source: "mention" as const }))
      : await this.resolveToSpeakers(stage, text, fromSpeaker);
    log.info({ stageId, fromSpeaker, targets: targets.map(t => `${t.speaker}(${t.source})`) }, "sendMessage");

    const message = this.deps.messagePort.createMessage({
      stage_id: stageId,
      from_speaker: fromSpeaker,
      to_speakers: targets.map(target => target.speaker),
      status: "completed",
    });

    this.deps.messagePort.setContext(message.id, "final_text", text);
    // 用户消息是即时完成的，不需要 onMessageStarted（前端已通过乐观更新显示）
    await this.notifyConsumers(stageId, "onMessageCompleted", message, this.deps.messagePort.getContext(message.id));

    // Router: 根据 to_speakers 触发下一步
    // fire-and-forget：route → dispatch → invokeAgent 链路可能阻塞数分钟（agent 运行 + 信号量排队），
    // 如果 await 会导致 HTTP 响应被阻塞，浏览器连接池耗尽后 UI 完全卡死。
    //
    // 错误处理：route() 可能因 dispatch 内 getUnreadMessages/advanceCursor 等 DB 操作失败而 reject，
    // 也可能因 invokeAgent 失败而传播异常（dispatch 内的 try-catch 仅覆盖 invokeAgent 调用）。
    // 这里用 .catch() 记录日志而非向上传播，因为：
    //   1. 消息已持久化 + WebSocket 已通知，用户已看到自己的消息
    //   2. agent 路由失败是后台操作，不应阻塞 HTTP 响应
    //   3. 与 resumeRoute() 的 try-catch 模式本质相同，区别仅在于 sendMessage 必须 fire-and-forget
    void this.route(stageId, message).catch((error) => {
      log.error({ stageId, messageId: message.id, err: error }, "sendMessage: route failed");
    });
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

  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[] {
    return [...(this.suggestions.get(stageId) ?? [])];
  }

  async advanceStage(stageId: string, targetKey: string): Promise<Stage> {
    const stage = this.deps.stagePort.advanceStage(stageId, targetKey);
    this.cleanupDispatchStates(stageId);
    this.initStageCursors(stage);
    return stage;
  }

  closeIssue(issueId: string): Issue {
    return this.deps.issuePort.closeIssue(issueId);
  }

  /** 启动恢复用：重新路由一条已完成消息的 to_speakers */
  async resumeRoute(stageId: string, message: Message): Promise<void> {
    try {
      await this.route(stageId, message);
    } catch (error) {
      log.error({ stageId, messageId: message.id, err: error }, "resumeRoute failed");
    }
  }

  /** 查询某个 stage 是否有任何 speaker 正在 invoking（用于 activity_status） */
  isInvoking(stageId: string): boolean {
    for (const [key, state] of this.dispatchStates) {
      if (key.startsWith(`${stageId}:`) && state.status === "invoking") return true;
    }
    return false;
  }

  /** 计算 stage 的 activity_status（唯一实现，供 route 和 websocket 共用） */
  getActivityStatus(stageId: string, issueClosedAt?: string | null): "ai_running" | "needs_human" | "completed" {
    if (issueClosedAt) return "completed";
    if (this.isInvoking(stageId)) return "ai_running";
    const latest = this.deps.messagePort.findLatestMessage(stageId);
    if (latest?.status === "streaming") return "ai_running";
    return "needs_human";
  }

  /** 清理某个 stage 的所有 dispatch 状态（stage 流转或关闭时调用） */
  private cleanupDispatchStates(stageId: string): void {
    const prefix = `${stageId}:`;
    for (const key of this.dispatchStates.keys()) {
      if (key.startsWith(prefix)) this.dispatchStates.delete(key);
    }
  }

  // ── Router: 事件驱动路由中枢 ────────────────────────────────────────

  /**
   * Router 唯一入口：消息完成时，根据 to_speakers 触发下一步行动。
   * 核心语义：cursor 决定 agent 认知边界，to_speakers 决定谁该行动。
   */
  private async route(stageId: string, message: Message): Promise<void> {
    const targets = message.to_speakers;
    if (targets.length === 0) return; // 无目标，stage 静默

    // Stage 已流转或 issue 已关闭，停止调度并清理
    const stage = this.deps.stagePort.findStage(stageId);
    if (!stage || stage.left_at) { this.cleanupDispatchStates(stageId); return; }

    const uniqueTargets = [...new Set(targets)];
    await Promise.all(uniqueTargets.map(speaker => this.dispatch(stageId, speaker)));
  }

  /**
   * Per-speaker 调度：去重 + 排队。
   * - 空闲 → 立即 invoke，期间新触发标记 pending，invoke 结束后自动用新 cursor 继续
   * - 正在 invoke → 标记 pending，等当前 invoke 结束后重新检查
   */
  private async dispatch(stageId: string, speaker: string): Promise<void> {
    const key = `${stageId}:${speaker}`;

    if (speaker === "user") {
      const latest = this.deps.messagePort.findLatestMessage(stageId);
      if (latest) await this.notifyConsumers(stageId, "onUserCalled", latest);
      return;
    }

    const existing = this.dispatchStates.get(key);
    if (existing?.status === "invoking") {
      // Agent 正在忙，标记 pending
      existing.pending = true;
      log.debug({ stageId, speaker }, "dispatch: agent busy, marked pending");
      return;
    }

    // Agent 空闲，开始 invoke 循环
    this.dispatchStates.set(key, { status: "invoking", pending: true });

    let remainingRounds = this.maxCollaborationRounds;
    while (remainingRounds > 0) {
      const state = this.dispatchStates.get(key);
      if (!state) return; // stage 已流转，dispatchStates 被并发清理
      state.pending = false;

      const unread = this.deps.messagePort.getUnreadMessages(stageId, speaker);
      if (unread.length === 0) {
        log.debug({ stageId, speaker }, "dispatch: no unread messages");
        this.dispatchStates.set(key, { status: "idle", pending: false });
        return;
      }

      log.debug({ stageId, speaker, unreadCount: unread.length }, "dispatch: invoking agent");
      try {
        await this.invokeAgent(stageId, speaker, unread);
        // invoke 成功后才推进 cursor，失败时 cursor 不动，下次重试
        this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
      } catch (error) {
        log.error({ stageId, speaker, err: error }, "dispatch: agent invocation failed");
        // cursor 未推进，消息不会丢失
      }

      // invoke 结束，检查 pending（期间可能有新消息到达，或 stage 已流转被清理）
      const current = this.dispatchStates.get(key);
      if (!current) return;
      if (!current.pending) {
        this.dispatchStates.set(key, { status: "idle", pending: false });
        return;
      }
      // 有新消息，继续下一轮 invoke
      remainingRounds--;
    }

    log.warn({ stageId, speaker }, "dispatch: max rounds reached");
    this.dispatchStates.set(key, { status: "idle", pending: false });
  }

  // ── Agent Invocation ────────────────────────────────────────────────

  private async invokeAgent(stageId: string, roleInstance: string, unreadMessages: Message[]): Promise<void> {
    const stage = this.mustGetStage(stageId);
    const issue = this.mustGetIssue(stage.issue_id);
    const assignment = this.deps.stagePort.getRoleSnailAssignment(stageId, roleInstance);
    if (!assignment) throw new Error(`Role assignment not found: ${stageId}:${roleInstance}`);

    log.info({
      stageId, roleInstance, snailKey: assignment.snail_key,
      snailInstanceId: assignment.snail_instance_id, unreadCount: unreadMessages.length, issueId: issue.id,
    }, "invokeAgent start");

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

      // 解析 @mentions 填入 to_speakers
      const targets = this.resolveReplies(stage, roleInstance, agentMessage.id);
      this.deps.messagePort.updateMessageTargets(agentMessage.id, targets);

      const context = this.extractTerminalContext(agentMessage.id, "completed");
      this.deps.messagePort.setContext(agentMessage.id, context.kind, context.context);
      this.deps.messagePort.completeMessage(agentMessage.id, "completed");
      const completedMessage = this.mustGetMessage(agentMessage.id);

      log.info({ stageId, roleInstance, messageId: agentMessage.id, contextKind: context.kind, targets }, "invokeAgent completed");
      await this.detectStageTransition(stage, roleInstance, completedMessage.id);
      await this.notifyConsumers(stageId, "onMessageCompleted", completedMessage, this.deps.messagePort.getContext(completedMessage.id));

      // Router: 根据 to_speakers 触发下一步（独立 try-catch，下游路由失败不标记当前 agent 为失败）
      try {
        await this.route(stageId, completedMessage);
      } catch (routeError) {
        log.error({ stageId, roleInstance, err: routeError }, "route after invokeAgent failed");
      }
    } catch (error) {
      log.error({
        stageId, roleInstance, issueId: issue.id, snailKey: assignment.snail_key,
        snailInstanceId: assignment.snail_instance_id,
        err: error,
      }, "invokeAgent failed");
      const status = abortController.signal.aborted ? "interrupted" : "failed";
      const context = this.extractTerminalContext(agentMessage.id, status);
      /** interrupted 时无 text event 则 context.kind 为 "event_summary"，context 内容为固定中断文案 */
      this.deps.messagePort.setContext(agentMessage.id, context.kind, context.context);
      this.deps.messagePort.completeMessage(agentMessage.id, status, { error: error instanceof Error ? error.message : String(error) });
      await this.notifyConsumers(stageId, "onMessageCompleted", this.mustGetMessage(agentMessage.id), this.deps.messagePort.getContext(agentMessage.id));
      throw error;
    } finally {
      this.activeInvocations.delete(agentMessage.id);
    }
  }

  private async executeAgentInvocation(input: {
    stageId: string; roleInstance: string; issue: Issue; stage: Stage;
    assignment: { snail_key: string; snail_instance_id: string | null; role_key: string };
    unreadMessages: Message[]; agentMessage: Message; signal?: AbortSignal;
  }) {
    const { stageId, roleInstance, issue, stage, assignment, unreadMessages, agentMessage, signal } = input;
    const systemReminder = this.buildSystemReminder({ issue, stage, roleInstance, roleKey: assignment.role_key });
    const invokeOptions: InvokeOptions = { signal };
    const agentMessages = unreadMessages.map(message => this.toAgentMessage(message));
    /** 唯一的上下文数据源：snail adapter 从这里构建 env vars，buildContextBlock 从 issue.context 渲染 system reminder */
    const firstCallRequest = {
      workspace_path: issue.workspace_path, messages: agentMessages, systemReminder: systemReminder || undefined,
      context: { issue_id: issue.id, stage_id: stage.id, message_id: String(agentMessage.id), stage_key: stage.key, role_instance: roleInstance, ...issue.context },
    };
    const resumeRequest = { workspace_path: issue.workspace_path, messages: agentMessages, system_reminder: systemReminder, messageId: String(agentMessage.id) };
    const onEvent = (event: AgentEvent) => this.handleAgentEvent(stageId, agentMessage.id, event);

    return assignment.snail_instance_id
      ? await this.invokeResumeOrRecover({ stageId, roleInstance, snailInstanceId: assignment.snail_instance_id, snailKey: assignment.snail_key, resumeRequest, firstCallRequest, onEvent, invokeOptions })
      : await this.deps.snailPort.invokeFirstCall(assignment.snail_key, firstCallRequest, onEvent, invokeOptions);
  }

  private async invokeResumeOrRecover(input: {
    stageId: string;
    roleInstance: string;
    snailInstanceId: string;
    snailKey: string;
    resumeRequest: SnailResumeRequest;
    firstCallRequest: SnailFirstCallRequest;
    onEvent: (event: AgentEvent) => void;
    invokeOptions: InvokeOptions;
  }) {
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

  private isMissingSnailInstanceError(error: unknown, snailInstanceId: string): boolean {
    return error instanceof Error && error.message === `Snail instance not found: ${snailInstanceId}`;
  }

  private handleAgentEvent(stageId: string, messageId: number, event: AgentEvent): void {
    const payload = this.mapAgentEvent(event);
    const appended = this.deps.messagePort.appendEvent(messageId, payload);
    void this.notifyConsumers(stageId, "onEvent", appended);
  }

  // ── Reply Resolution ────────────────────────────────────────────────

  private resolveReplies(stage: Stage, roleInstance: string, messageId: number): string[] {
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

  // ── Stage Transition Detection ──────────────────────────────────────

  private async detectStageTransition(stage: Stage, roleInstance: string, messageId: number): Promise<void> {
    const suggestion = this.extractStageTransitionSuggestion(stage, roleInstance, messageId);
    if (!suggestion) return;

    const suggestions = this.suggestions.get(stage.id) ?? [];
    suggestions.push(suggestion);
    this.suggestions.set(stage.id, suggestions);
    await this.notifyConsumers(stage.id, "onStageTransitionSuggested", suggestion);
  }

  private extractStageTransitionSuggestion(stage: Stage, roleInstance: string, messageId: number): StageTransitionSuggestion | null {
    for (const event of this.deps.messagePort.getMessageEvents(messageId)) {
      if (event.payload.type === "signal" && typeof event.payload.stage_transition === "object" && event.payload.stage_transition) {
        const payload = event.payload.stage_transition as Record<string, unknown>;
        const targetKey = String(payload.target_key ?? payload.to ?? "");
        if (!targetKey || !stage.available_transitions.some(transition => transition.to === targetKey)) continue;
        return this.makeStageTransitionSuggestion({ stage, roleInstance, messageId, targetKey, reason: payload.reason, guard: payload.guard });
      }

      if (event.payload.type === "text") {
        const parsed = this.tryParseStageTransition(event.payload.text);
        if (parsed?.target_key && stage.available_transitions.some(transition => transition.to === parsed.target_key)) {
          return this.makeStageTransitionSuggestion({ stage, roleInstance, messageId, targetKey: parsed.target_key, reason: parsed.reason, guard: parsed.guard });
        }
      }
    }
    return null;
  }

  private makeStageTransitionSuggestion(input: {
    stage: Stage;
    roleInstance: string;
    messageId: number;
    targetKey: string;
    reason: unknown;
    guard: unknown;
  }): StageTransitionSuggestion {
    const { stage, roleInstance, messageId, targetKey, reason, guard } = input;
    const transition = stage.available_transitions.find(item => item.to === targetKey);
    return {
      stage_id: stage.id,
      message_id: messageId,
      from_speaker: roleInstance,
      target_key: targetKey,
      reason: typeof reason === "string" ? reason : "",
      guard: typeof guard === "string" ? guard : transition?.guard ?? null,
      artifacts: { ...stage.output_artifacts },
      created_at: new Date().toISOString(),
    };
  }

  private tryParseStageTransition(text: string): { target_key?: string; reason?: string; guard?: string | null } | null {
    try {
      const parsed = JSON.parse(text) as { stage_transition?: { target_key?: string; reason?: string; guard?: string | null } };
      return parsed.stage_transition ?? null;
    } catch {
      log.debug({ textLength: text.length }, "stage_transition.parse.skipped");
      return null;
    }
  }

  // ── Mention Resolution ──────────────────────────────────────────────

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

  // ── Context & System Reminder ───────────────────────────────────────

  private extractTerminalContext(messageId: number, status: "completed" | "interrupted" | "failed"): MessageContext {
    const existing = this.deps.messagePort.getContext(messageId);
    if (existing?.kind === "mcp_final_body") return existing;

    const events = this.deps.messagePort.getMessageEvents(messageId);
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.payload.type === "text" && event.payload.text.trim()) {
        return { message_id: messageId, kind: "final_text", context: event.payload.text, created_at: new Date().toISOString() };
      }
    }

    /** 无 text event 也无 mcp_final_body 时返回状态对应的兜底文案，不 dump 原始 event 给用户 */
    const fallback = status === "interrupted" ? "用户中断了本次回复" : status === "failed" ? "任务执行失败" : "（无文本输出）";
    return { message_id: messageId, kind: "event_summary", context: fallback, created_at: new Date().toISOString() };
  }

  private buildSystemReminder(input: { issue: Issue; stage: Stage; roleInstance: string; roleKey: string }): string {
    const { issue, stage, roleInstance, roleKey } = input;
    const stageDefinition = issue.sop_snapshot.stage_definitions.find(definition => definition.key === stage.key);
    const roleDef = stageDefinition?.roles.find(role => role.key === roleKey);
    const roleName = roleDef?.name ?? roleInstance;

    return [
      this.buildIdentityBlock(roleName, roleInstance, roleDef),
      this.buildContextBlock(issue, stage, roleDef),
    ].join("\n\n");
  }

  private buildIdentityBlock(roleName: string, roleInstance: string, roleDef: RoleDefinition | undefined): string {
    return `<identity>
# 你是${roleName}
**角色实例**：${roleInstance}
**职责**：${roleDef?.description ?? "请参考 skill 中的工作流程"}
**禁止**：${roleDef?.prohibition ?? "请参考 skill 中的禁止项"}
**自检**：${roleDef?.self_check ?? "请参考 skill 中的自检规则"}
</identity>`;
  }

  private buildContextBlock(issue: Issue, stage: Stage, roleDef: RoleDefinition | undefined): string {
    const transitions = stage.available_transitions.map(transition => `- ${transition.to}${transition.guard ? `: ${transition.guard}` : ""}`).join("\n");
    const sharedSkill = issue.sop_snapshot.shared_skill;
    const skillList = [
      sharedSkill ? `- \`${sharedSkill}\` — 共享规则（特性编号、PR签名、证据规则、完成标准）` : null,
      roleDef?.skill ? `- \`${roleDef.skill}\` — ${roleDef.name}工作流程` : null,
    ].filter(Boolean).join("\n");

    /** Issue 上下文：只读视图，Agent 应使用 MCP 工具读写 */
    const issueContext = Object.keys(issue.context).length > 0
      ? Object.entries(issue.context).map(([key, value]) => `- **${key}**: ${value}`).join("\n")
      : "无";

    return `<context>
## 项目上下文

**Issue**：${issue.title}
**Issue ID**：${issue.id}
**工作区**：${issue.workspace_path}
**Issue 摘要**：${issue.summary ?? "无"}

## Issue 上下文（只读视图）

${issueContext}

> **注意**：这是只读视图。Agent 应使用 MCP 工具 \`set_context\` 和 \`get_context\` 读写 Issue 上下文。
> Issue 上下文也会通过环境变量 \`SNAIL_CTX_*\` 注入，可通过 \`process.env\` 读取。

## 当前阶段

**阶段**：${stage.title} (${stage.key})
**阶段描述**：${stage.description}
**所有角色实例**：${stage.role_instances.join(", ")}

## 可用 Skills

${skillList}

使用 skill tool 触发对应的 skill，获取详细工作流程和规则。

## 可用流转

${transitions || "无"}

## 协作规则

- 你可以通过 @角色实例 请求其他角色回应
- 你是当前阶段的守门人，不是推进者。建议 stage_transition 前，必须先完成所在 SKILL.md 中的 Stage Gate 自检并呈现完整证据。未完成自检不得建议推进。
- 永远不要自动推进 Stage
</context>`;
  }

  private toAgentMessage(message: Message): AgentMessage {
    const context = this.deps.messagePort.getContext(message.id);
    const prefix = message.to_speakers.length > 0 ? `${message.to_speakers.map(target => `@${target}`).join(" ")} ` : "";
    return {
      role: message.from_speaker === "user" ? "human" : message.from_speaker === "system" || message.from_speaker === null ? "system" : "agent",
      speaker: message.from_speaker ?? "system",
      content: `${prefix}${context?.context ?? ""}`.trim(),
    };
  }

  private mapAgentEvent(event: AgentEvent): MessageEventPayload {
    const agentEvent = event.event;
    if (agentEvent.kind === "text") {
      return { type: "text", text: agentEvent.payload.text };
    }
    if (agentEvent.kind === "tool_call") {
      return { type: "tool_call", tool_name: agentEvent.payload.tool_name, tool_input: agentEvent.payload.input };
    }
    if (agentEvent.kind === "tool_result") {
      return { type: "tool_result", tool_name: "tool", result: agentEvent.payload.output };
    }
    if (agentEvent.kind === "signal") {
      const data = typeof agentEvent.payload.data === "object" && agentEvent.payload.data ? agentEvent.payload.data as Record<string, unknown> : {};
      return { type: "signal", signal: agentEvent.payload.signal_type, ...data };
    }
    if (agentEvent.kind === "error") {
      return { type: "error", error: agentEvent.payload.message };
    }
    return { type: "error", error: agentEvent.payload.error };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private initStageCursors(stage: Stage): void {
    this.deps.messagePort.initCursor(stage.id, "user");
    for (const roleInstance of stage.role_instances) {
      this.deps.messagePort.initCursor(stage.id, roleInstance);
    }
  }

  private createInitialStage(issue: Issue, stageKey = issue.sop_snapshot.stage_definitions[0]?.key): Stage {
    if (!stageKey) throw new Error(`No stage definitions found for issue: ${issue.id}`);
    const stage = this.deps.stagePort.createStage({
      issue_id: issue.id,
      key: stageKey,
    });
    this.initStageCursors(stage);
    return stage;
  }

  private mustGetStage(stageId: string): Stage {
    const stage = this.deps.stagePort.findStage(stageId);
    if (!stage) throw new Error(`Stage not found: ${stageId}`);
    return stage;
  }

  private mustGetIssue(issueId: string): Issue {
    const issue = this.deps.issuePort.findIssue(issueId);
    if (!issue) throw new Error(`Issue not found: ${issueId}`);
    return issue;
  }

  private mustGetMessage(messageId: number): Message {
    const message = this.deps.messagePort.getMessage(messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    return message;
  }

  private assertIssueOpen(issueId: string): void {
    const issue = this.deps.issuePort.findIssue(issueId);
    if (issue?.closed_at) throw new Error(`Issue is closed: ${issueId}`);
  }

  private async notifyConsumers(stageId: string, method: keyof CollaborationConsumer, ...args: unknown[]): Promise<void> {
    const stage = this.mustGetStage(stageId);
    const consumers = [...(this.issueConsumers.get(stage.issue_id) ?? [])];
    await Promise.allSettled(consumers.map(async consumer => {
      if (method === "onMessageStarted" && consumer.onMessageStarted) {
        await consumer.onMessageStarted(stageId, args[0] as Message);
        return;
      }
      if (method === "onEvent" && consumer.onEvent) {
        await consumer.onEvent(stageId, args[0] as MessageEvent);
        return;
      }
      if (method === "onMessageCompleted") {
        await consumer.onMessageCompleted(stageId, args[0] as Message, args[1] as MessageContext | null);
        return;
      }
      if (method === "onUserCalled") {
        await consumer.onUserCalled(stageId, args[0] as Message);
        return;
      }
      if (method === "onStageTransitionSuggested" && consumer.onStageTransitionSuggested) {
        await consumer.onStageTransitionSuggested(stageId, args[0] as StageTransitionSuggestion);
      }
    }));
  }
}
