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
import { StageQueue } from "@app/issue-collaboration/stage-queue";
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

export class IssueCollaboration implements CollaborationInput {
  private readonly issueConsumers = new Map<string, Set<CollaborationConsumer>>();
  private readonly queue = new StageQueue();
  private readonly suggestions = new Map<string, StageTransitionSuggestion[]>();
  private readonly maxCollaborationRounds: number;
  private readonly activeInvocations = new Map<number, AbortController>();

  constructor(private readonly deps: CollaborationDeps) {
    this.maxCollaborationRounds = deps.maxCollaborationRounds ?? 30;
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    return this.deps.stagePort.transaction(() => {
      const issue = this.deps.createIssue(input);
      const stage = this.createInitialStage(issue);
      return { issue, stage };
    });
  }

  interruptMessage(messageId: number): boolean {
    const controller = this.activeInvocations.get(messageId);
    if (!controller) return false;
    controller.abort();
    this.activeInvocations.delete(messageId);
    log.info({ messageId }, "interruptMessage");
    return true;
  }

  async sendMessage(stageId: string, text: string, fromSpeaker = "user", toSpeakers?: string[]): Promise<void> {
    const stage = this.mustGetStage(stageId);
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
    for (const target of targets) {
      this.deps.messagePort.createCallSignal(stageId, target.speaker);
    }

    await this.notifyConsumers(stageId, "onMessageStarted", message);
    await this.notifyConsumers(stageId, "onMessageCompleted", message, this.deps.messagePort.getContext(message.id));
    this.enqueueStage(stageId);
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
    this.initStageCursors(stage);
    return stage;
  }

  enqueueStage(stageId: string): void {
    this.queue.enqueue(stageId, async () => this.drainStage(stageId));
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

  private async drainStage(stageId: string): Promise<void> {
    let remainingRounds = this.maxCollaborationRounds;

    while (remainingRounds > 0) {
      const signals = this.deps.messagePort.getCallSignals(stageId);
      if (signals.length === 0) return;

      const targetSpeakers = [...new Set(signals.map(signal => signal.target_speaker))];
      log.debug({ stageId, targetSpeakers, remainingRounds }, "drainStage");

      const executions = targetSpeakers.map(async speaker => {
        this.deps.messagePort.deleteCallSignal(stageId, speaker);

        if (speaker === "user") {
          const latest = this.deps.messagePort.listMessages(stageId).at(-1);
          if (latest) await this.notifyConsumers(stageId, "onUserCalled", latest);
          return false;
        }

        const unread = this.deps.messagePort.getUnreadMessages(stageId, speaker);
        if (unread.length === 0) {
          log.debug({ stageId, speaker }, "skip speaker (no unread)");
          return false;
        }

        log.debug({ stageId, speaker, unreadCount: unread.length }, "invoking agent");
        this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
        await this.invokeAgent(stageId, speaker, unread);
        return true;
      });

      const results = await Promise.allSettled(executions);
      const agentCalls = results.filter(result => result.status === "fulfilled" && result.value).length;
      const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (errors.length > 0) {
        log.error({ stageId, errors: errors.map(e => e.reason?.message ?? String(e.reason)) }, "drainStage agent errors");
      }
      if (agentCalls === 0) return;
      remainingRounds -= agentCalls;
    }
  }

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

      const context = this.extractTerminalContext(agentMessage.id, "completed");
      this.deps.messagePort.setContext(agentMessage.id, context.kind, context.context);
      this.deps.messagePort.completeMessage(agentMessage.id, "completed");
      const completedMessage = this.mustGetMessage(agentMessage.id);

      log.info({ stageId, roleInstance, messageId: agentMessage.id, contextKind: context.kind }, "invokeAgent completed");
      this.routeAgentReplies(stage, roleInstance, completedMessage.id);
      await this.detectStageTransition(stage, roleInstance, completedMessage.id);
      await this.notifyConsumers(stageId, "onMessageCompleted", completedMessage, this.deps.messagePort.getContext(completedMessage.id));
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
    const invokeOptions: InvokeOptions = {
      signal,
      contextEnv: { issue_id: issue.id, stage_id: stage.id, message_id: String(agentMessage.id), role_instance: roleInstance },
    };
    const agentMessages = unreadMessages.map(message => this.toAgentMessage(message));
    const firstCallRequest = {
      workspace_path: issue.workspace_path, messages: agentMessages, systemReminder: systemReminder || undefined,
      context: { issue_id: issue.id, stage_id: stage.id, message_id: String(agentMessage.id), stage_key: stage.key, role_instance: roleInstance },
    };
    const resumeRequest = { workspace_path: issue.workspace_path, messages: agentMessages, system_reminder: systemReminder };
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

  private routeAgentReplies(stage: Stage, roleInstance: string, messageId: number): void {
    const replies = this.resolveReplies(stage, roleInstance, messageId);
    this.deps.messagePort.updateMessageTargets(messageId, replies);
    for (const speaker of replies) {
      this.deps.messagePort.createCallSignal(stage.id, speaker);
    }
  }

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
    } catch {
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
    const artifacts = Object.entries(stage.output_artifacts).map(([key, value]) => `${key}: ${value}`).join("\n");
    const sharedSkill = issue.sop_snapshot.shared_skill;
    const skillList = [
      sharedSkill ? `- \`${sharedSkill}\` — 共享规则（特性编号、PR签名、证据规则、完成标准）` : null,
      roleDef?.skill ? `- \`${roleDef.skill}\` — ${roleDef.name}工作流程` : null,
    ].filter(Boolean).join("\n");

    return `<context>
## 项目上下文

**Issue**：${issue.title}
**Issue ID**：${issue.id}
**工作区**：${issue.workspace_path}
**Issue 摘要**：${issue.summary ?? "无"}
**可扩展上下文**：${issue.extendable_context != null ? JSON.stringify(issue.extendable_context) : "无"}

## 当前阶段

**阶段**：${stage.title} (${stage.key})
**阶段描述**：${stage.description}
**阶段产物**：\n${artifacts || "无"}
**所有角色实例**：${stage.role_instances.join(", ")}

## 可用 Skills

${skillList}

使用 skill tool 触发对应的 skill，获取详细工作流程和规则。

## 可用流转

${transitions || "无"}

## 协作规则

- 你可以通过 @角色实例 请求其他角色回应
- 如果阶段看起来完成了，建议 stage_transition 等待用户确认
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

  private initStageCursors(stage: Stage): void {
    this.deps.messagePort.initCursor(stage.id, "user");
    for (const roleInstance of stage.role_instances) {
      this.deps.messagePort.initCursor(stage.id, roleInstance);
    }
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
