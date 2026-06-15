import type { Message, MessageContext, MessageEvent, MessageEventPayload } from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type { IssuePort, StagePort } from "@domain/issue/port";
import type { Issue, Stage } from "@domain/issue/model";
import type { SnailPort } from "@domain/snail/port";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { AgentEvent, Message as AgentMessage, InvokeOptions } from "@infra/acs/model";
import type { CollaborationConsumer, CollaborationInput, LaunchIssueInput, StageTransitionSuggestion } from "./port";
import { StageQueue } from "./stage-queue";

interface CollaborationDeps {
  issuePort: IssuePort;
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
  private readonly consumers = new Map<string, Set<CollaborationConsumer>>();
  private readonly queue = new StageQueue();
  private readonly suggestions = new Map<string, StageTransitionSuggestion[]>();
  private readonly maxCollaborationRounds: number;

  constructor(private readonly deps: CollaborationDeps) {
    this.maxCollaborationRounds = deps.maxCollaborationRounds ?? 30;
  }

  async launchIssue(input: LaunchIssueInput): Promise<Stage> {
    const issue = this.deps.issuePort.findIssue(input.issue_id);
    if (!issue) throw new Error(`Issue not found: ${input.issue_id}`);

    const stageKey = input.stage_key ?? issue.sop_snapshot.stage_definitions[0]?.key;
    if (!stageKey) throw new Error(`No stage definitions found for issue: ${input.issue_id}`);

    const stagePreview = this.deps.stagePort.previewStage(issue.id, stageKey);
    this.ensureAssignments(stagePreview.role_instances.map(role => role.role_instance), input.snail_assignments);

    const stage = this.deps.stagePort.createStage({
      issue_id: issue.id,
      key: stageKey,
      snail_assignments: input.snail_assignments,
    });
    this.initStageCursors(stage);

    if (input.initial_message) {
      await this.sendMessage(stage.id, input.initial_message, "user");
    }

    return stage;
  }

  async sendMessage(stageId: string, text: string, fromSpeaker = "user"): Promise<void> {
    const stage = this.mustGetStage(stageId);
    const targets = await this.resolveToSpeakers(stage, text, fromSpeaker);
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

  registerConsumer(stageId: string, consumer: CollaborationConsumer): void {
    const consumers = this.consumers.get(stageId) ?? new Set<CollaborationConsumer>();
    consumers.add(consumer);
    this.consumers.set(stageId, consumers);
  }

  unregisterConsumer(stageId: string, consumer: CollaborationConsumer): void {
    const consumers = this.consumers.get(stageId);
    if (!consumers) return;
    consumers.delete(consumer);
    if (consumers.size === 0) this.consumers.delete(stageId);
  }

  listStageTransitionSuggestions(stageId: string): StageTransitionSuggestion[] {
    return [...(this.suggestions.get(stageId) ?? [])];
  }

  async advanceStage(stageId: string, targetKey: string, snailAssignments: Record<string, string>): Promise<Stage> {
    const stage = this.deps.stagePort.advanceStage(stageId, targetKey, snailAssignments);
    this.initStageCursors(stage);
    return stage;
  }

  enqueueStage(stageId: string): void {
    this.queue.enqueue(stageId, async () => this.drainStage(stageId));
  }

  private async drainStage(stageId: string): Promise<void> {
    let remainingRounds = this.maxCollaborationRounds;

    while (remainingRounds > 0) {
      const signals = this.deps.messagePort.getCallSignals(stageId);
      if (signals.length === 0) return;

      const targetSpeakers = [...new Set(signals.map(signal => signal.target_speaker))];
      const executions = targetSpeakers.map(async speaker => {
        this.deps.messagePort.deleteCallSignal(stageId, speaker);

        if (speaker === "user") {
          const latest = this.deps.messagePort.listMessages(stageId).at(-1);
          if (latest) await this.notifyConsumers(stageId, "onUserCalled", latest);
          return false;
        }

        const unread = this.deps.messagePort.getUnreadMessages(stageId, speaker);
        if (unread.length === 0) return false;

        this.deps.messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id);
        await this.invokeAgent(stageId, speaker, unread);
        return true;
      });

      const results = await Promise.allSettled(executions);
      const agentCalls = results.filter(result => result.status === "fulfilled" && result.value).length;
      if (agentCalls === 0) return;
      remainingRounds -= agentCalls;
    }
  }

  private async invokeAgent(stageId: string, roleInstance: string, unreadMessages: Message[]): Promise<void> {
    const stage = this.mustGetStage(stageId);
    const issue = this.mustGetIssue(stage.issue_id);
    const assignment = this.deps.stagePort.getRoleSnailAssignment(stageId, roleInstance);
    if (!assignment) throw new Error(`Role assignment not found: ${stageId}:${roleInstance}`);

    const agentMessage = this.deps.messagePort.createMessage({
      stage_id: stageId,
      from_speaker: roleInstance,
      to_speakers: [],
      status: "streaming",
    });
    await this.notifyConsumers(stageId, "onMessageStarted", agentMessage);

    const handbook = this.deps.stagePort.getRoleHandbook(stageId, assignment.role_key);
    const systemReminder = this.buildSystemReminder({ issue, stage, roleInstance, roleKey: assignment.role_key, handbook });
    const firstCallHandbook = [handbook, systemReminder].filter(Boolean).join("\n\n");
    const invokeOptions: InvokeOptions = {
      contextEnv: { issue_id: issue.id, stage_id: stage.id, message_id: String(agentMessage.id), role_instance: roleInstance },
    };

    try {
      const result = assignment.snail_instance_id
        ? await this.deps.snailPort.invokeResume(
            assignment.snail_instance_id,
            {
              workspace_path: issue.workspace_path,
              messages: unreadMessages.map(message => this.toAgentMessage(message)),
              system_reminder: systemReminder,
            },
            event => this.handleAgentEvent(stageId, agentMessage.id, event),
            invokeOptions,
          )
        : await this.deps.snailPort.invokeFirstCall(
            assignment.snail_key,
            {
              workspace_path: issue.workspace_path,
              messages: unreadMessages.map(message => this.toAgentMessage(message)),
              handbook: firstCallHandbook || undefined,
              context: {
                issue_id: issue.id,
                stage_id: stage.id,
                message_id: String(agentMessage.id),
                stage_key: stage.key,
                role_instance: roleInstance,
                system_reminder: systemReminder,
              },
            },
            event => this.handleAgentEvent(stageId, agentMessage.id, event),
            invokeOptions,
          );

      if (result.snail_instance_id && result.snail_instance_id !== assignment.snail_instance_id) {
        this.deps.stagePort.setSnailInstanceId(stageId, roleInstance, result.snail_instance_id);
      }

      const context = this.extractTerminalContext(agentMessage.id);
      this.deps.messagePort.setContext(agentMessage.id, context.kind, context.context);
      this.deps.messagePort.completeMessage(agentMessage.id, "completed");
      const completedMessage = this.mustGetMessage(agentMessage.id);

      this.routeAgentReplies(stage, roleInstance, completedMessage.id);
      await this.detectStageTransition(stage, roleInstance, completedMessage.id);
      await this.notifyConsumers(stageId, "onMessageCompleted", completedMessage, this.deps.messagePort.getContext(completedMessage.id));
    } catch (error) {
      const context = this.extractTerminalContext(agentMessage.id);
      this.deps.messagePort.setContext(agentMessage.id, "event_summary", context.context);
      this.deps.messagePort.completeMessage(agentMessage.id, "failed", { error: error instanceof Error ? error.message : String(error) });
      await this.notifyConsumers(stageId, "onMessageCompleted", this.mustGetMessage(agentMessage.id), this.deps.messagePort.getContext(agentMessage.id));
      throw error;
    }
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

  private extractTerminalContext(messageId: number): MessageContext {
    const existing = this.deps.messagePort.getContext(messageId);
    if (existing?.kind === "mcp_final_body") return existing;

    const events = this.deps.messagePort.getMessageEvents(messageId);
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.payload.type === "text" && event.payload.text.trim()) {
        return { message_id: messageId, kind: "final_text", context: event.payload.text, created_at: new Date().toISOString() };
      }
    }

    return { message_id: messageId, kind: "event_summary", context: this.summarizeEvents(events), created_at: new Date().toISOString() };
  }

  private summarizeEvents(events: MessageEvent[]): string {
    return events.map(event => {
      if (event.payload.type === "text") return event.payload.text;
      if (event.payload.type === "tool_call") return `[tool_call:${event.payload.tool_name}]`;
      if (event.payload.type === "tool_result") return `[tool_result:${event.payload.tool_name}]`;
      if (event.payload.type === "signal") return `[signal:${event.payload.signal}]`;
      if (event.payload.type === "error") return `[error:${event.payload.error}]`;
      return `[${event.payload.type}]`;
    }).join("\n");
  }

  private buildSystemReminder(input: { issue: Issue; stage: Stage; roleInstance: string; roleKey: string; handbook: string | null }): string {
    const { issue, stage, roleInstance, roleKey, handbook } = input;
    const transitions = stage.available_transitions.map(transition => `- ${transition.to}${transition.guard ? `: ${transition.guard}` : ""}`).join("\n");
    const artifacts = Object.entries(stage.output_artifacts).map(([key, value]) => `${key}: ${value}`).join("\n");
    const sections = [
      `<issue>\nissue_id: ${issue.id}\nworkspace_path: ${issue.workspace_path}\nissue_title: ${issue.title}\nissue_summary: ${issue.summary ?? ""}\n</issue>`,
      `<stage>\nstage_id: ${stage.id}\nstage_key: ${stage.key}\nstage_title: ${stage.title}\nstage_description: ${stage.description}\nrole_key: ${roleKey}\nrole_instance: ${roleInstance}\nall_role_instances: ${stage.role_instances.join(", ")}\n</stage>`,
      `<available_transitions>\n${transitions || "none"}\n</available_transitions>`,
      `<stage_artifacts>\n${artifacts || "none"}\n</stage_artifacts>`,
      `<collaboration_rules>\n- You may @mention another role instance to request its response.\n- If the stage appears complete, suggest a stage_transition for the user to confirm.\n- Never auto-advance the Stage.\n</collaboration_rules>`,
    ];

    if (issue.sop_snapshot.shared_handbook) sections.push(`<shared_handbook>\n${issue.sop_snapshot.shared_handbook}\n</shared_handbook>`);
    if (handbook) sections.push(`<role_handbook>\n${handbook}\n</role_handbook>`);
    return sections.join("\n\n");
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

  private ensureAssignments(roleInstances: string[], assignments: Record<string, string>): void {
    const allowed = new Set(roleInstances);
    for (const roleInstance of roleInstances) {
      if (!assignments[roleInstance]) throw new Error(`Missing snail assignment for role instance: ${roleInstance}`);
    }
    for (const roleInstance of Object.keys(assignments)) {
      if (!allowed.has(roleInstance)) throw new Error(`Unknown role instance in snail assignments: ${roleInstance}`);
    }
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
    const consumers = [...(this.consumers.get(stageId) ?? [])];
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
