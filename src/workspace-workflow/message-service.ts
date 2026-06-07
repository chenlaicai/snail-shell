/**
 * Message sending and interrupt service.
 *
 * Pure functions extracted from WorkspaceManager that handle message
 * dispatch, collaboration, and interrupt management.
 */
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import type { ConversationStore, RoleName } from "../persistence/store";
import type { CollaborationInvocationOptions } from "../message-bus/collaboration";
import { sendStructuredMessage as sendStructuredMessageWithCollaboration } from "../message-bus/collaboration";
import type { ConversationQueue } from "./conversation-queue";
import type { MessageInterruptRegistry } from "../message-bus/message-interrupt";
import { buildPlainTextEvent, type MessageInputEvent } from "../message-bus/message-events";
import { assertConversationIssueWritable } from "./manager-detail";
import { resolveConversationSystemPrompt, resolveConversationRole, resolveMentions, type CollaborationDeps } from "./manager-collaboration";
import type { WorkspaceManagerDeps } from "./manager-types";

const MAX_COLLABORATION_ROUNDS = 30;

export interface MessageServiceDeps {
  store: ConversationStore;
  wmDeps: WorkspaceManagerDeps;
  conversationQueue: ConversationQueue;
  messageInterrupts: MessageInterruptRegistry;
  collaborationDeps: CollaborationDeps;
  getShuttingDown: () => boolean;
  onStageTransitionDetected: (conversationId: string, targetStageKey: string, reason: string | null) => void;
  emitBadgeUpdate: (conversationId: string) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

export async function sendMessage(deps: MessageServiceDeps, conversationId: string, userContent: string): Promise<{ messageIds: number[] }> {
  return sendStructuredMessage(deps, conversationId, [buildPlainTextEvent(userContent)]);
}

export async function sendStructuredMessage(
  deps: MessageServiceDeps,
  conversationId: string,
  userParts: MessageInputEvent[],
  options: { fromRole?: RoleName; quotedMessageId?: number | null; askerRole?: RoleName | null; clientId?: string | null } = {},
): Promise<{ messageIds: number[] }> {
  if (deps.getShuttingDown()) throw new Error("Server is shutting down");
  assertConversationIssueWritable(deps.store, conversationId);
  const { fromRole = HUMAN_ROLE_NAME, quotedMessageId = null, askerRole = null, clientId = null } = options;
  return deps.conversationQueue.enqueue(conversationId, async () => {
    const result = await sendStructuredMessageWithCollaboration(
      buildCollaborationInvokeDeps(deps, conversationId),
      conversationId,
      userParts,
      MAX_COLLABORATION_ROUNDS,
      { fromRole, quotedMessageId, askerRole, clientId },
    );
    deps.emitBadgeUpdate(conversationId);
    return result;
  });
}

export async function sendConversationMessage(
  deps: MessageServiceDeps,
  conversationId: string,
  input: { content?: string; events?: MessageInputEvent[]; fromRole?: RoleName; quotedMessageId?: number | null; clientId?: string | null },
): Promise<{ messageIds: number[] } | { error: { message: string } }> {
  try {
    const events = input.events ?? (input.content ? [buildPlainTextEvent(input.content)] : []);
    if (events.length === 0) return { error: { message: "No content provided" } };
    return await sendStructuredMessage(deps, conversationId, events, { fromRole: input.fromRole, quotedMessageId: input.quotedMessageId, clientId: input.clientId });
  } catch (err: any) {
    return { error: { message: err.message } };
  }
}

export function interruptMessage(deps: MessageServiceDeps, conversationId: string, messageId: number): { interrupted: boolean } {
  assertConversationIssueWritable(deps.store, conversationId);
  const message = deps.store.getMessage(messageId, conversationId);
  if (!message) throw new Error(`Message not found: ${messageId}`);
  if (message.role !== "assistant") throw new Error(`Message is not interruptible: ${messageId}`);
  return { interrupted: deps.messageInterrupts.interrupt(conversationId, messageId) };
}

export function interruptAllRunningMessages(deps: MessageServiceDeps): void {
  deps.messageInterrupts.interruptAll();
}

export async function waitForAllAgentProcessesStopped(deps: MessageServiceDeps): Promise<void> {
  await deps.messageInterrupts.waitForAllStopped();
}

/** Build the dependency object needed by sendStructuredMessageWithCollaboration. */
export function buildCollaborationInvokeDeps(deps: MessageServiceDeps, conversationId: string) {
  const cd = deps.collaborationDeps;
  return {
    store: deps.store,
    emitAgentEvent: (targetConversationId: string, event: Record<string, unknown>) => deps.emit("agent-event", targetConversationId, event),
    buildConversationSystemPrompt: (targetConversationId: string, options: CollaborationInvocationOptions) => resolveConversationSystemPrompt(cd, targetConversationId, options),
    resolveMentions: (targetConversationId: string, events: MessageInputEvent[], isAgentReply?: boolean) => resolveMentions(cd, targetConversationId, events, isAgentReply),
    refreshConversationSummary: async () => { /* disabled — relying on agent-side state tracking */ },
    messageContextSummaryGenerator: null,
    resolveRole: (roleName: RoleName) => resolveConversationRole(cd, conversationId, roleName),
    resolveRuntimeByRole: (role: any) => {
      const templateId = role.snail_template_id;
      if (!templateId) throw new Error(`No snail template for role: ${role.name}`);
      return deps.wmDeps.snailDen.getSnailRuntime(templateId).runtime;
    },
    resolveRoleTemplate: (role: any) => {
      const templateId = role.snail_template_id;
      if (!templateId) return undefined;
      const template = deps.wmDeps.snailDen.getTemplate(templateId);
      if (!template) return undefined;
      return {
        templateId,
        runtime: template.runtime,
        model: template.model,
        contextProvider: template.contextProvider,
        contextWindow: template.contextWindow,
        invocationTimeoutMs: template.invocationTimeoutMs,
      };
    },
    lookupOrCreateSnailAgentSession: (targetConversationId: string, roleName: string, role: any) => {
      const existing = deps.store.getCurrentSnailAgentSession(targetConversationId, roleName);
      const templateId = role.snail_template_id;
      if (!templateId) throw new Error(`No snail template for role: ${roleName}`);
      const template = deps.wmDeps.snailDen.getTemplate(templateId);
      if (!template) throw new Error(`Snail template not found: ${templateId}`);
      if (existing && existing.runtime === template.runtime && existing.model === template.model) return existing;
      return deps.store.createSnailAgentSession({ id: `${targetConversationId}:${roleName}:${Date.now()}`, conversationId: targetConversationId, roleName, runtime: template.runtime, model: template.model, contextProvider: template.contextProvider });
    },
    updateSnailAgentSessionExternalId: (sessionId: string, externalSessionId: string | null) => { deps.store.updateSnailAgentSessionExternalId(sessionId, externalSessionId); },
    createInterruptController: () => deps.messageInterrupts.createRunController(),
    bindInterruptMessage: (targetConversationId: string, messageId: number, controller: AbortController) => deps.messageInterrupts.bindMessage(targetConversationId, messageId, controller),
    registerStopPromise: (targetConversationId: string, messageId: number, stopPromise: Promise<void>) => deps.messageInterrupts.registerStopPromise(targetConversationId, messageId, stopPromise),
    finishInterruptMessage: (targetConversationId: string, messageId: number) => deps.messageInterrupts.finishMessage(targetConversationId, messageId),
    onStageTransitionDetected: (targetConversationId: string, targetStageKey: string, reason: string | null) => {
      deps.onStageTransitionDetected(targetConversationId, targetStageKey, reason);
    },
  };
}
