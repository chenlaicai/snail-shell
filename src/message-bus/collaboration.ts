import { getAgentInvocationStopDetail, isAgentInvocationInterrupted, isAgentInvocationStopped, type AgentEvent, type AgentInvocationOptions, type AgentRuntime, type SnailRuntimeMessageInput } from "../agent/interface";
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import type { AgentCapability } from "../agent/capability";
import type { MessageContextSummaryGenerator } from "../shared/types";
import type { Conversation, ConversationStore, CreateMessageEventInput, MessageRuntime, MessageWithEvents, RoleName, SnailAgentSession, RuntimeBinding, InvocationSubject } from "../persistence/store";
import type { RoleDefinition } from "../roles";
import { createHash } from "crypto";
import fs from "fs";
import { buildAgentMessages } from "./agent-message";
import { buildPlainTextEvent, buildTextEvent, extractMentionsFromInputs, type MessageInputEvent } from "./message-events";
import { extractEmbeddedMessageOutCandidate, parseMessageOutPayload } from "./message-out";
import { logger } from "../logger";
import { logAgentInput } from "../agent/message-flow-logger";
import { createStreamingContext, finalizeMessageLifecycle, invokeRuntimeMessage, normalizeRuntime } from "./message-protocol";
import { permissionStore } from "../agent/permission-store";
import { drainMessageBus, MessageBusDrainError, type MessageBusBatch } from "./message-bus";
import { buildTerminalMessageContext, formatMessageContextForPrompt } from "./message-context";

const SYSTEM_SNAIL_NAME = "system";

// systemReminder 变化检测：按 session 跟踪最新 hash，仅变化时注入。
const systemReminderHashBySession = new Map<string, string>();

function systemReminderHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function resolveEffectiveSystemReminder(session: SnailAgentSession, systemReminder: string): { reminder: string; pendingHash?: string } {
  // stateless（shell 管理上下文）每次都注入；stateful 仅在 hash 变化时注入
  if (session.context_provider === "shell") return { reminder: systemReminder };
  const hash = systemReminderHash(systemReminder);
  const lastHash = systemReminderHashBySession.get(session.id);
  if (hash === lastHash) return { reminder: "" };
  // hash 写入延迟到 agent 调用成功后，避免失败重试时吞掉 reminder
  return { reminder: systemReminder, pendingHash: hash };
}

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

interface CollaborationDeps {
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

interface ResolvedInvocationContext {
  conversation: Conversation;
  activeRole: RoleDefinition;
  runtime: { invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => Promise<{ sessionId?: string | null }>; runtime: AgentRuntime };
  capability: AgentCapability;
  session: SnailAgentSession;
  subject: InvocationSubject;
}

/**
 * 从当前运行态解析 InvocationSubject。
 *
 * Why: 将 role/runtime/stage 信息打包为结构化对象，
 * 让下游不再反查 role→snail→runtime 链路。
 */
function resolveInvocationSubject(deps: CollaborationDeps, conversation: Conversation, activeRole: RoleDefinition): InvocationSubject {
  if (!conversation.workspace_id || !conversation.issue_id || !conversation.stage_id) {
    throw new Error(`Conversation context is incomplete: ${conversation.id}`);
  }

  const template = deps.resolveRoleTemplate?.(activeRole);
  const runtimeBinding: InvocationSubject["runtimeBinding"] = template
    ? {
        templateId: template.templateId,
        runtime: template.runtime,
        model: template.model,
        contextProvider: template.contextProvider,
        contextWindow: template.contextWindow,
        invocationTimeoutMs: template.invocationTimeoutMs,
      }
    : { templateId: "", runtime: "", model: "", contextProvider: "shell" };

  const stage = deps.store.getStage(conversation.stage_id);
  const gateArtifacts = stage?.gate_evidence?.items;

  return {
    workspaceId: conversation.workspace_id,
    issueId: conversation.issue_id,
    stageId: conversation.stage_id,
    conversationId: conversation.id,
    role: {
      key: activeRole.key,
      name: activeRole.name,
      description: activeRole.description,
      rules: [],
      isPrimary: activeRole.is_primary === 1,
    },
    runtimeBinding,
    gateArtifacts,
  };
}

function resolveInvocationContext(deps: CollaborationDeps, conversationId: string, batch: MessageBusBatch, options: CollaborationInvocationOptions): ResolvedInvocationContext {
  const conversation = deps.store.getConversation(conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}, targetRole: ${options.activeRoleName}`);
  const activeRole = deps.resolveRole(options.activeRoleName);
  if (!activeRole) throw new Error(`Role not found: ${options.activeRoleName}, conversationId: ${conversationId}`);
  if (!isAgentRole(activeRole)) throw new Error(`Role is not an agent: ${options.activeRoleName}, conversationId: ${conversationId}`);
  const subject = resolveInvocationSubject(deps, conversation, activeRole);
  const runtime = deps.resolveRuntimeByRole(activeRole);
  const { capability } = deps.buildConversationSystemPrompt(conversationId, { ...options, runtime: runtime.runtime });
  const session = deps.lookupOrCreateSnailAgentSession(conversationId, activeRole.name, activeRole);
  return { conversation, activeRole, runtime, capability, session, subject };
}

async function invokeRoleBatch(deps: CollaborationDeps, conversationId: string, batch: MessageBusBatch, options: CollaborationInvocationOptions): Promise<{ messageId: number }> {
  const ctx = resolveInvocationContext(deps, conversationId, batch, options);
  const effectiveSessionId = ctx.session.context_provider === "shell" ? null : ctx.session.external_session_id;
  const inboxMessageIds = new Set(batch.messages.map((message) => message.id));
  const history = deps.store.getRecentConversationMessagesWindow(conversationId, 3).filter((message) => message.id <= batch.contextCutoffMessageId && !inboxMessageIds.has(message.id));
  const model = ctx.subject.runtimeBinding.model || undefined;
  const contextWindow = ctx.subject.runtimeBinding.contextWindow;
  const invocationTimeoutMs = ctx.subject.runtimeBinding.invocationTimeoutMs;
  const latestUserEvents = buildInboxPromptEvents(batch.messages);
  const { reminder, pendingHash } = resolveEffectiveSystemReminder(ctx.session, ctx.capability.systemReminder);
  ctx.capability.systemReminder = reminder;

  const workspaceRoot = resolveWorkspaceRootForInvocation(deps.store, ctx.conversation, conversationId);
  const runtimeInput = buildRuntimeInput(
    { workspaceRoot, conversation: ctx.conversation, activeRole: ctx.activeRole, capability: ctx.capability, history },
    latestUserEvents, batch.messages, effectiveSessionId,
  );

  logAgentInput(ctx.runtime.runtime, runtimeInput, effectiveSessionId);
  logger.info("Invoking agent", { conversationId, role: ctx.activeRole.name, dispatchCount: batch.dispatches.length });

  const streamingContext = createStreamingContext({
    deps, conversationId, activeRole: ctx.activeRole,
    resolvedRuntime: normalizeRuntime(ctx.runtime.runtime),
    contextCutoffAt: batch.contextCutoffAt, snailAgentSessionId: ctx.session.id,
  });
  const controller = deps.createInterruptController();
  deps.bindInterruptMessage(conversationId, streamingContext.session.assistantMessageId, controller);
  /** deferred：agent 启动前注册到 registry，invokeRuntimeMessage 完成后 resolve。 */
  let resolveAgentDone!: () => void;
  const agentDonePromise = new Promise<void>((resolve) => { resolveAgentDone = resolve; });
  deps.registerStopPromise(conversationId, streamingContext.session.assistantMessageId, agentDonePromise);
  deps.store.markConversationDispatchesConsumed(conversationId, batch.dispatches.map((dispatch) => dispatch.id), streamingContext.session.assistantMessageId);
  try {
    const result = await invokeRuntimeMessage(
      ctx.runtime.invokeMessage.bind(ctx.runtime), streamingContext, runtimeInput,
      { signal: controller.signal, model, contextWindow, invocationTimeoutMs },
    );

    // 硬拒绝（匹配 denyPatterns）优先于软拒绝（不在黑白名单中）
    if (streamingContext.session.terminalFailure) throw new Error(streamingContext.session.terminalFailure);

    // agent 因不在黑白名单中的操作被拒 → 转为 pending_approval 等待用户审批
    if (streamingContext.session.pendingPermissionRequest) {
      return finalizePendingApproval(streamingContext, batch, conversationId, result.messageId, ctx.activeRole.name);
    }
    // 仅在确认无 failure 后提交 hash，避免 message_failure 路径重试时吞掉 reminder
    if (pendingHash) systemReminderHashBySession.set(ctx.session.id, pendingHash);
    scanAndExecuteStageTransition(deps, conversationId, result.messageId);
    const mentionSourceEvents = getMentionSourceEvents(deps, conversationId, result.messageId, ctx.activeRole.name);
    const toRoles = await resolveAgentMessageRouting({
      deps, conversationId, conversation: ctx.conversation, activeRole: ctx.activeRole,
      mentionSourceEvents, forcedWrapUp: options.forcedWrapUp,
    });
    deps.store.updateMessageRouting(result.messageId, toRoles);
    await finalizeMessageLifecycle(streamingContext, { status: "completed", finalRole: "assistant" });
    return { messageId: result.messageId };
  } catch (error) {
    await handleInvocationError(error, streamingContext, deps, ctx);
    throw error; // unreachable: handleInvocationError always throws, needed for TS control flow
  } finally {
    resolveAgentDone();
    deps.finishInterruptMessage(conversationId, streamingContext.session.assistantMessageId);
  }
}

async function handleInvocationError(error: unknown, streamingContext: ReturnType<typeof createStreamingContext>, deps: CollaborationDeps, ctx: ResolvedInvocationContext): Promise<never> {
  if (isAgentInvocationInterrupted(error)) {
    const stopDetail = getAgentInvocationStopDetail(error);
    await finalizeMessageLifecycle(streamingContext, { status: "interrupted", finalRole: "assistant", stopDetail });
    if (stopDetail?.forced) deps.updateSnailAgentSessionExternalId(ctx.session.id, null);
    throw new CollaborationInterruptedError([{ messageId: streamingContext.session.assistantMessageId, roleName: ctx.activeRole.name }]);
  }
  const stopDetail = getAgentInvocationStopDetail(error);
  await finalizeMessageLifecycle(streamingContext, { status: "failed", finalRole: "assistant", errorText: error instanceof Error ? error.message : String(error), stopDetail });
  if (stopDetail) deps.updateSnailAgentSessionExternalId(ctx.session.id, null);
  throw error;
}

export function isCollaborationInterrupted(error: unknown): error is CollaborationInterruptedError {
  return error instanceof CollaborationInterruptedError;
}

export function isCollaborationStopFailure(error: unknown): boolean {
  return isAgentInvocationStopped(error);
}

async function resolveAgentMessageRouting(input: { deps: CollaborationDeps; conversationId: string; conversation: Conversation; activeRole: RoleDefinition; mentionSourceEvents: MessageInputEvent[]; forcedWrapUp: boolean }): Promise<RoleName[]> {
  const { deps, conversationId, conversation, activeRole, mentionSourceEvents, forcedWrapUp } = input;
  const mentionResolution = await deps.resolveMentions(conversationId, mentionSourceEvents, true);
  return forcedWrapUp ? [] : resolveMessageToRoles({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: false, askerRole: null, latestRespondingRole: null, senderRole: activeRole.name });
}

function getMentionSourceEvents(deps: CollaborationDeps, conversationId: string, messageId: number, roleName: string): MessageInputEvent[] {
  const events = deps.store.getMessageEvents(messageId).flatMap((event) => {
    if (event.kind === "text" || event.kind === "content_block") return [{ kind: event.kind, payload: event.payload, source: event.source } as MessageInputEvent];
    return [];
  });
  const text = events.filter((event) => event.kind === "text").map((event) => event.payload.text).join("");
  const textIsEntireMessage = events.length > 0 && events.every((event) => event.kind === "text");
  if (textIsEntireMessage && text.trim()) return [parseMessageOutTextIfPresent(text, roleName)];
  return events;
}

function parseMessageOutTextIfPresent(text: string, roleName: string): MessageInputEvent {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith("{") ? trimmed : extractEmbeddedMessageOutCandidate(trimmed);
  if (candidate) {
    try {
      const event = parseMessageOutPayload(candidate);
      logger.debug("Agent returned message-out payload", { role: roleName, kind: event.kind });
      return event;
    } catch (error) {
      logger.debug("Agent text is not a message-out payload; treating as plain text", { role: roleName, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!trimmed) throw new Error(`Missing message output from ${roleName}`);
  return buildPlainTextEvent(trimmed);
}

function resolveWorkspaceRootForInvocation(store: ConversationStore, conversation: Conversation, conversationId: string): string {
  const workspaceId = conversation.workspace_id;
  if (!workspaceId) throw new Error(`Conversation ${conversationId} has no workspace_id`);
  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  if (!fs.existsSync(workspace.workspace_root) || !fs.statSync(workspace.workspace_root).isDirectory()) {
    throw new Error(`workspace_root does not exist or is not a directory: ${workspace.workspace_root} {workspace: ${workspaceId})`);
  }
  try { fs.accessSync(workspace.workspace_root, fs.constants.R_OK | fs.constants.W_OK); }
  catch { throw new Error(`workspace_root is not readable/writable: ${workspace.workspace_root} {workspace: ${workspaceId})`); }
  return workspace.workspace_root;
}

function buildRuntimeInput(context: { workspaceRoot: string; conversation: Conversation; activeRole: RoleDefinition; capability: AgentCapability; history: MessageWithEvents[] }, latestUserEvents: CreateMessageEventInput[], incrementalMessages: MessageWithEvents[], externalSessionId: string | null): SnailRuntimeMessageInput {
  const { workspaceRoot, conversation, activeRole, capability, history } = context;
  return { workspaceRoot, conversation, role: activeRole, capability, history: buildAgentMessages(conversation, history), latestUserEvents, incrementalMessages, externalSessionId };
}

function isAgentRole(role: RoleDefinition): boolean {
  return Boolean(role.snail_template_id);
}

function isAutoRespondingRole(role: RoleDefinition | undefined): boolean {
  if (!role || role.name === HUMAN_ROLE_NAME) return false;
  return isAgentRole(role);
}

function buildInboxPromptEvents(messages: MessageWithEvents[]): MessageInputEvent[] {
  const prompt = messages.map((message) => `${message.from_role ?? message.role}:\n${formatMessageContextForPrompt(message)}`).join("\n\n");
  return [buildTextEvent(prompt, [])];
}

function resolveMessageToRoles(options: { conversation: Conversation; mentions: ResolvedMention[]; shouldFallbackToDefault: boolean; askerRole: RoleName | null; latestRespondingRole: RoleName | null; senderRole: RoleName }): RoleName[] {
  const { conversation, mentions, shouldFallbackToDefault, askerRole, latestRespondingRole, senderRole } = options;
  const hadExplicitMentions = mentions.length > 0;
  const seen = new Set<RoleName>();
  const toRoles: RoleName[] = [];
  for (const mention of mentions) {
    const roleName = mention.roleName;
    if (roleName === senderRole) continue;
    if (!conversation.participating_roles.includes(roleName) || seen.has(roleName)) continue;
    seen.add(roleName);
    toRoles.push(roleName);
  }
  const fallbackRole = resolveFallbackRole({ conversation, hadExplicitMentions, shouldFallbackToDefault, askerRole, latestRespondingRole, senderRole });
  if (toRoles.length === 0 && fallbackRole) toRoles.push(fallbackRole);
  return toRoles;
}

function resolveFallbackRole(options: { conversation: Conversation; hadExplicitMentions: boolean; shouldFallbackToDefault: boolean; askerRole: RoleName | null; latestRespondingRole: RoleName | null; senderRole: RoleName }): RoleName | null {
  const { conversation, hadExplicitMentions, shouldFallbackToDefault, askerRole, latestRespondingRole, senderRole } = options;
  if (senderRole !== HUMAN_ROLE_NAME) return null;
  if (askerRole && askerRole !== HUMAN_ROLE_NAME && conversation.participating_roles.includes(askerRole)) return askerRole;
  if (!hadExplicitMentions && latestRespondingRole && conversation.participating_roles.includes(latestRespondingRole)) return latestRespondingRole;
  if (!hadExplicitMentions && shouldFallbackToDefault && conversation.participating_roles.includes(conversation.default_role)) return conversation.default_role;
  return null;
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
function scanAndExecuteStageTransition(deps: CollaborationDeps, conversationId: string, messageId: number): void {
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

async function finalizePendingApproval(
  streamingContext: ReturnType<typeof createStreamingContext>,
  batch: MessageBusBatch,
  conversationId: string,
  messageId: number,
  roleName: string,
): Promise<{ messageId: number }> {
  // 从 batch 中找发送给当前 role 的触发消息，支持 Boss→agent 和 agent→agent 两种场景。
  // role === "user" 只覆盖 Boss 输入；agent→agent 时 batch 消息 role 为 "assistant"。
  const triggerMsg = batch.messages.find((m) => m.to_roles.includes(roleName)) ?? batch.messages[0];
  const existing = triggerMsg ? permissionStore.get(conversationId, messageId) : undefined;
  if (existing && triggerMsg) {
    existing.originalUserMessageId = triggerMsg.id;
    existing.originalRoleName = roleName;
    existing.originalFromRole = triggerMsg.from_role ?? HUMAN_ROLE_NAME;
  }
  await finalizeMessageLifecycle(streamingContext, { status: "pending_approval", finalRole: "assistant" });
  return { messageId };
}
