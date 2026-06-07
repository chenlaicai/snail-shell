import { isAgentInvocationStopped, type AgentEvent, type AgentInvocationOptions, type AgentRuntime, type SnailRuntimeMessageInput } from "../agent/interface";
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import type { AgentCapability } from "../agent/capability";
import type { MessageContextSummaryGenerator } from "../shared/types";
import type { Conversation, ConversationStore, CreateMessageEventInput, MessageRuntime, MessageWithEvents, RoleName, SnailAgentSession, RuntimeBinding } from "../persistence/store";
import type { RoleDefinition } from "../roles";
import { buildPlainTextEvent, extractMentionsFromInputs, type MessageInputEvent } from "./message-events";
import { logger } from "../logger";
import { drainMessageBus, MessageBusDrainError } from "./message-bus";
import { buildTerminalMessageContext } from "./message-context";
import { invokeRoleBatch, resolveMessageToRoles, isAgentRole } from "./role-invoker";

const SYSTEM_SNAIL_NAME = "system";

export interface CollaborationInvocationOptions {
  activeRoleName: RoleName;
  remainingRounds: number;
  mentionAllowed: boolean;
  forcedWrapUp: boolean;
  runtime?: AgentRuntime;
  /** 当前响应 Snail 的可展示名称，从 SnailTemplate.name 获取，用于 PR 评论签名。 */
  snailDisplayName?: string;
}

export interface ResolvedMention {
  roleName: RoleName;
  raw: string;
  source: "structured_event" | "llm_fallback";
}

export interface MentionResolution {
  mentions: ResolvedMention[];
  messageText: string;
}

export interface SendStructuredMessageResult {
  messageIds: number[];
}

export interface InterruptedRoleInvocation {
  messageId: number;
  roleName: RoleName;
}

export class CollaborationInterruptedError extends Error {
  readonly interruptedInvocations: InterruptedRoleInvocation[];

  constructor(interruptedInvocations: InterruptedRoleInvocation[]) {
    super("Collaboration interrupted");
    this.name = "CollaborationInterruptedError";
    this.interruptedInvocations = interruptedInvocations;
  }
}

export interface CollaborationDeps {
  store: ConversationStore;
  emitAgentEvent: (conversationId: string, event: Record<string, unknown>) => void;
  buildConversationSystemPrompt: (conversationId: string, options: CollaborationInvocationOptions) => { systemPrompt: string; capability: AgentCapability };
  resolveMentions: (conversationId: string, events: MessageInputEvent[], isAgentMessage?: boolean) => Promise<MentionResolution>;
  refreshConversationSummary: (conversationId: string) => Promise<void>;
  messageContextSummaryGenerator?: MessageContextSummaryGenerator | null;
  resolveRole: (roleName: RoleName) => RoleDefinition | undefined;
  resolveRuntimeByRole: (role: RoleDefinition) => { invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => Promise<{ sessionId?: string | null }>; runtime: AgentRuntime };
  /** 从 Snail Den 获取指定 role 关联 template 的元数据；role 未关联 template 时返回 undefined。 */
  resolveRoleTemplate?: (role: RoleDefinition) => RuntimeBinding | undefined;
  /** 为当前 conversation + role 查找或创建 snail_agent_session */
  lookupOrCreateSnailAgentSession: (conversationId: string, roleName: string, role: RoleDefinition) => SnailAgentSession;
  /** 更新 snail_agent_session 的 external_session_id */
  updateSnailAgentSessionExternalId: (sessionId: string, externalSessionId: string | null) => void;
  createInterruptController: () => AbortController;
  bindInterruptMessage: (conversationId: string, messageId: number, controller: AbortController) => void;
  registerStopPromise: (conversationId: string, messageId: number, stopPromise: Promise<void>) => void;
  finishInterruptMessage: (conversationId: string, messageId: number) => void;
  /**
   * Agent 输出中检测到 stage_transition 提议时回调。
   * 由 manager 层实现，内部调用 transitionIssueStage。
   * 失败仅 log.warn，不阻塞（agent 消息已完成）。
   */
  onStageTransitionDetected?: (conversationId: string, targetStageKey: string, reason: string | null) => void;
  onPermissionRequired: (context: { conversationId: string; messageId: number; request: unknown; roleName: string }) => void;
}

interface SendStructuredMessageOptions {
  fromRole?: RoleName;
  quotedMessageId?: number | null;
  askerRole?: RoleName | null;
  clientId?: string | null;
}

export async function sendStructuredMessage(deps: CollaborationDeps, conversationId: string, userEvents: MessageInputEvent[], maxCollaborationRounds: number, options: SendStructuredMessageOptions = {}): Promise<SendStructuredMessageResult> {
  const { fromRole = HUMAN_ROLE_NAME, quotedMessageId = null, askerRole = null, clientId = null } = options;
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (userEvents.length === 0) throw new Error("message must contain at least one content event");

  const contextCutoffAt = String(deps.store.getLatestMessage(conversationId)?.id ?? 0);
  const role = fromRole === HUMAN_ROLE_NAME ? "user" : "assistant";
  const mentionResolution = await deps.resolveMentions(conversationId, userEvents);
  /**
   * 用户追问的隐含对象来自 conversation 末尾语境，而不是默认 role 配置。
   * 这里必须通过专门的末尾读模型判断最近可自动响应的 role，避免 getMessages 默认分页截断长对话后把路由带回 default_role。
   */
  const respondingRoleCandidates = conversation.participating_roles.filter((roleName) => isAutoRespondingRole(deps.resolveRole(roleName)));
  const latestRespondingRole = fromRole === HUMAN_ROLE_NAME ? deps.store.getLatestRespondingRole(conversationId, respondingRoleCandidates) : null;
  const toRoles = resolveMessageToRoles({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: fromRole === HUMAN_ROLE_NAME, askerRole, latestRespondingRole, senderRole: fromRole });
  const userMessage = deps.store.addMessage({ conversationId, clientId, fromRole: fromRole, toRoles: toRoles, role, quotedMessageId, contextCutoffAt, runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, userMessage.id, fromRole, role, clientId);
  appendEvent(deps, conversationId, userMessage.id, fromRole, { kind: "start", payload: { role, role_name: fromRole, runtime: "system" }, source: { runtime_name: "system" } }, clientId);
  userEvents.forEach((event) => appendEvent(deps, conversationId, userMessage.id, fromRole, event, clientId));
  const terminalEvent = deps.store.completeMessageWithEvent(userMessage.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  const messageContext = await persistMessageContext(deps, conversationId, userMessage.id);
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: userMessage.id, role_name: fromRole, event: terminalEvent, ...(clientId ? { client_id: clientId } : {}) });
  deps.emitAgentEvent(conversationId, { type: "message_context_updated", message_id: userMessage.id, role_name: fromRole, context: messageContext, ...(clientId ? { client_id: clientId } : {}) });
  deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: userMessage.id, status: "completed", role_name: fromRole, final_role: role, context: messageContext, ...(clientId ? { client_id: clientId } : {}) });

  try {
    const result = await drainMessageBus({
      store: deps.store,
      handleBossMention: persistBossMentionNotice.bind(null, deps),
      handleWrapUp: persistWrapUpNotice.bind(null, deps),
      invokeBatch: invokeRoleBatch.bind(null, deps),
    }, conversationId, maxCollaborationRounds);
    await refreshConversationSummarySafely(deps, conversationId);
    return { messageIds: [userMessage.id, ...result.messageIds] };
  } catch (error) {
    const interruptedResult = buildInterruptedSendResult(userMessage.id, error);
    if (interruptedResult) {
      await refreshConversationSummarySafely(deps, conversationId);
      return interruptedResult;
    }
    throw unwrapMessageBusDrainError(error);
  }
}

function buildInterruptedSendResult(userMessageId: number, error: unknown): SendStructuredMessageResult | null {
  const interruptedErrors = getInterruptedErrors(error);
  if (interruptedErrors.length === 0) return null;
  const messageIds = [userMessageId, ...getCompletedMessageIds(error), ...interruptedErrors.flatMap((item) => item.interruptedInvocations.map((invocation) => invocation.messageId))];
  return { messageIds: Array.from(new Set(messageIds)) };
}

function getInterruptedErrors(error: unknown): CollaborationInterruptedError[] {
  if (isCollaborationInterrupted(error)) return [error];
  if (error instanceof MessageBusDrainError && error.causes.length > 0 && error.causes.every(isCollaborationInterrupted)) return error.causes;
  return [];
}

function getCompletedMessageIds(error: unknown): number[] {
  return error instanceof MessageBusDrainError ? error.messageIds : [];
}

function unwrapMessageBusDrainError(error: unknown): unknown {
  if (error instanceof MessageBusDrainError && error.causes.length === 1) return error.causes[0];
  return error;
}

async function refreshConversationSummarySafely(deps: CollaborationDeps, conversationId: string): Promise<void> {
  try {
    await deps.refreshConversationSummary(conversationId);
  } catch (error) {
    logger.warn("Failed to refresh conversation summary, continuing without it", { conversationId, error });
  }
}

export function isCollaborationInterrupted(error: unknown): error is CollaborationInterruptedError {
  return error instanceof CollaborationInterruptedError;
}

export function isCollaborationStopFailure(error: unknown): boolean {
  return isAgentInvocationStopped(error);
}

function isAutoRespondingRole(role: RoleDefinition | undefined): boolean {
  if (!role || role.name === HUMAN_ROLE_NAME) return false;
  return isAgentRole(role);
}

function persistWrapUpNotice(deps: CollaborationDeps, conversationId: string, defaultRoleName: RoleName): void {
  persistSystemNotice(deps, conversationId, `已达到非 boss role 协作轮数上限，转由 ${defaultRoleName} 收口。`);
}

function persistBossMentionNotice(deps: CollaborationDeps, conversationId: string, messages: MessageWithEvents[]): void {
  void messages;
  /**
   * Boss Role 是人工参与者，系统消息只负责标记"需要人工接管"的状态。
   * 被 mention 的原消息已经保留在对话流和 history 工具中；这里重复拼接正文会把提醒误变成对话记录副本，放大长消息噪音。
   */
  persistSystemNotice(deps, conversationId, "有消息 mention 到老大，等待人工回复。");
}

function persistSystemNotice(deps: CollaborationDeps, conversationId: string, notice: string): void {
  const message = deps.store.addMessage({ conversationId, fromRole: null, toRoles: [], role: "system", contextCutoffAt: String(deps.store.getLatestMessage(conversationId)?.id ?? 0), runtime: "system", status: "streaming" });
  emitMessageStarted(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, "system", null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, { kind: "start", payload: { role: "system", role_name: null, runtime: "system" }, source: { runtime_name: "system" } }, null);
  appendEvent(deps, conversationId, message.id, SYSTEM_SNAIL_NAME, buildPlainTextEvent(notice), null);
  const terminalEvent = deps.store.completeMessageWithEvent(message.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  const messageContextPromise = persistMessageContext(deps, conversationId, message.id);
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: message.id, role_name: SYSTEM_SNAIL_NAME, event: terminalEvent });
  void messageContextPromise.then((messageContext) => {
    deps.emitAgentEvent(conversationId, { type: "message_context_updated", message_id: message.id, role_name: SYSTEM_SNAIL_NAME, context: messageContext });
    deps.emitAgentEvent(conversationId, { type: "message_status_changed", message_id: message.id, status: "completed", role_name: SYSTEM_SNAIL_NAME, final_role: "system", context: messageContext });
  });
}

async function persistMessageContext(deps: CollaborationDeps, conversationId: string, messageId: number): Promise<unknown> {
  const message = deps.store.getMessage(messageId, conversationId);
  if (!message) return null;
  const built = await buildTerminalMessageContext({ message, events: deps.store.getMessageEvents(messageId), summaryGenerator: deps.messageContextSummaryGenerator ?? null });
  return deps.store.upsertMessageContext(messageId, built.kind, built.context);
}

function emitMessageStarted(deps: CollaborationDeps, conversationId: string, messageId: number, roleName: string, role: "user" | "assistant" | "system", clientId: string | null): void {
  deps.emitAgentEvent(conversationId, { type: "message_started", message_id: messageId, status: "streaming", role_name: roleName, role, ...(clientId ? { client_id: clientId } : {}) });
}

function appendEvent(deps: CollaborationDeps, conversationId: string, messageId: number, roleName: string, event: CreateMessageEventInput, clientId: string | null): void {
  const persisted = deps.store.addMessageEvent(messageId, withSystemSource(event));
  deps.emitAgentEvent(conversationId, { type: "message_event_appended", message_id: messageId, role_name: roleName, event: persisted, ...(clientId ? { client_id: clientId } : {}) });
}

function withSystemSource(event: CreateMessageEventInput): CreateMessageEventInput {
  const runtime: MessageRuntime = "system";
  return { ...event, source: { runtime_name: runtime, ...(event.source ?? {}) } } as CreateMessageEventInput;
}

/**
 * 从 agent 消息事件中扫描 stage_transition 提议 JSON，找到则执行转移。
 *
 * Why: stage_transition 是副作用信号，不进入 message event 管线。
 * 只能从 agent 原始文本输出中提取。扫描在 finalizeMessageLifecycle 之后进行，
 * 此时 agent 消息已完成，转移失败不会阻塞消息流程。
 */
export function scanAndExecuteStageTransition(deps: CollaborationDeps, conversationId: string, messageId: number): void {
  if (!deps.onStageTransitionDetected) return;
  const events = deps.store.getMessageEvents(messageId);
  for (const event of events) {
    if (event.kind !== "text") continue;
    const text = (event.payload as { text?: string })?.text;
    if (!text) continue;
    const transition = extractStageTransition(text);
    if (transition) {
      try {
        deps.onStageTransitionDetected(conversationId, transition.target_stage, transition.reason ?? null);
      } catch (error) {
        logger.warn("Stage transition from agent output failed", { conversationId, targetStage: transition.target_stage, error: error instanceof Error ? error.message : String(error) });
      }
      return; // 只执行第一个有效的 stage_transition
    }
  }
}

export function extractStageTransition(text: string): { target_stage: string; reason?: string } | null {
  // 快速跳过不包含关键词的文本
  if (!text.includes("stage_transition")) return null;
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && parsed.format === "stage_transition" && typeof parsed.target_stage === "string") {
      return { target_stage: parsed.target_stage, reason: parsed.reason };
    }
  } catch {
    // 非 JSON，尝试从嵌入文本中提取
    /**
     * Why [^{}]*：当前规范中 reason 为字符串，JSON 对象不含嵌套花括号。
     * 若未来 reason 扩展为对象（如 {"detail": "..."}），此正则将无法匹配，
     * 需升级为递归或使用完整 JSON 解析器。此处保持简单以覆盖当前用例。
     */
    const match = text.match(/\{[^{}]*"format"\s*:\s*"stage_transition"[^{}]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed.target_stage === "string") return { target_stage: parsed.target_stage, reason: parsed.reason };
      } catch { /* malformed JSON, ignore */ }
    }
  }
  return null;
}

export function structuredMentionsFromEvents(conversation: Conversation, events: MessageInputEvent[]): ResolvedMention[] {
  return extractMentionsFromInputs(events)
    .filter((roleName) => conversation.participating_roles.includes(roleName))
    .map((roleName) => ({ roleName, raw: `@${roleName}`, source: "structured_event" as const }));
}

