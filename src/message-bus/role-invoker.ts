import { getAgentInvocationStopDetail, isAgentInvocationInterrupted, type AgentEvent, type AgentInvocationOptions, type AgentRuntime, type SnailRuntimeMessageInput } from "../agent/interface";
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import type { AgentCapability } from "../agent/capability";
import type { Conversation, ConversationStore, CreateMessageEventInput, MessageWithEvents, RoleName, SnailAgentSession, InvocationSubject } from "../persistence/store";
import type { RoleDefinition } from "../roles";
import { createHash } from "crypto";
import fs from "fs";
import { buildAgentMessages } from "./agent-message";
import { buildPlainTextEvent, buildTextEvent, type MessageInputEvent } from "./message-events";
import { extractEmbeddedMessageOutCandidate, parseMessageOutPayload } from "./message-out";
import { logger } from "../logger";
import { logAgentInput } from "../agent/message-flow-logger";
import { createStreamingContext, finalizeMessageLifecycle, invokeRuntimeMessage, normalizeRuntime } from "./message-protocol";
import { permissionStore } from "../agent/permission-store";
import type { MessageBusBatch } from "./message-bus";
import { formatMessageContextForPrompt } from "./message-context";
import type { CollaborationDeps, CollaborationInvocationOptions, ResolvedMention } from "./collaboration";
import { CollaborationInterruptedError, scanAndExecuteStageTransition } from "./collaboration";

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

interface ResolvedInvocationContext {
  conversation: Conversation;
  activeRole: RoleDefinition;
  runtime: { invokeMessage: (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => Promise<{ sessionId?: string | null }>; runtime: AgentRuntime };
  capability: AgentCapability;
  session: SnailAgentSession;
  subject: InvocationSubject;
}

function resolveInvocationContext(deps: CollaborationDeps, conversationId: string, _batch: MessageBusBatch, options: CollaborationInvocationOptions): ResolvedInvocationContext {
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

export async function invokeRoleBatch(deps: CollaborationDeps, conversationId: string, batch: MessageBusBatch, options: CollaborationInvocationOptions): Promise<{ messageId: number }> {
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

export async function resolveAgentMessageRouting(input: { deps: CollaborationDeps; conversationId: string; conversation: Conversation; activeRole: RoleDefinition; mentionSourceEvents: MessageInputEvent[]; forcedWrapUp: boolean }): Promise<RoleName[]> {
  const { deps, conversationId, conversation, activeRole, mentionSourceEvents, forcedWrapUp } = input;
  const mentionResolution = await deps.resolveMentions(conversationId, mentionSourceEvents, true);
  return forcedWrapUp ? [] : resolveMessageToRoles({ conversation, mentions: mentionResolution.mentions, shouldFallbackToDefault: false, askerRole: null, latestRespondingRole: null, senderRole: activeRole.name });
}

export function resolveMessageToRoles(options: { conversation: Conversation; mentions: ResolvedMention[]; shouldFallbackToDefault: boolean; askerRole: RoleName | null; latestRespondingRole: RoleName | null; senderRole: RoleName }): RoleName[] {
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

function buildRuntimeInput(context: { workspaceRoot: string; conversation: Conversation; activeRole: RoleDefinition; capability: AgentCapability; history: MessageWithEvents[] }, latestUserEvents: CreateMessageEventInput[], incrementalMessages: MessageWithEvents[], externalSessionId: string | null): SnailRuntimeMessageInput {
  const { workspaceRoot, conversation, activeRole, capability, history } = context;
  return { workspaceRoot, conversation, role: activeRole, capability, history: buildAgentMessages(conversation, history), latestUserEvents, incrementalMessages, externalSessionId };
}

export function isAgentRole(role: RoleDefinition): boolean {
  return Boolean(role.snail_template_id);
}

function buildInboxPromptEvents(messages: MessageWithEvents[]): MessageInputEvent[] {
  const prompt = messages.map((message) => `${message.from_role ?? message.role}:\n${formatMessageContextForPrompt(message)}`).join("\n\n");
  return [buildTextEvent(prompt, [])];
}

const validatedWorkspaceRoots = new Set<string>();

function resolveWorkspaceRootForInvocation(store: ConversationStore, conversation: Conversation, conversationId: string): string {
  const workspaceId = conversation.workspace_id;
  if (!workspaceId) throw new Error(`Conversation ${conversationId} has no workspace_id`);
  const workspace = store.fileConfigStore.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  if (!validatedWorkspaceRoots.has(workspace.workspace_root)) {
    if (!fs.existsSync(workspace.workspace_root) || !fs.statSync(workspace.workspace_root).isDirectory()) {
      throw new Error(`workspace_root does not exist or is not a directory: ${workspace.workspace_root} {workspace: ${workspaceId})`);
    }
    try { fs.accessSync(workspace.workspace_root, fs.constants.R_OK | fs.constants.W_OK); }
    catch { throw new Error(`workspace_root is not readable/writable: ${workspace.workspace_root} {workspace: ${workspaceId})`); }
    validatedWorkspaceRoots.add(workspace.workspace_root);
  }
  return workspace.workspace_root;
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
