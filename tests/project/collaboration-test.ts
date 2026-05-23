import fs from "fs";
import path from "path";
import { AgentInvocationInterruptedError, AgentInvocationTerminatedError, type AgentEvent, type AgentInvocationOptions, type AgentStopDetail, type SnailRuntimeMessageInput } from "../../src/agent/interface";
import { ConversationStore, type Conversation, type CreateMessageEventInput, type RoleName } from "../../src/persistence/store";
import type { KnowledgeWithDetails } from "../../src/persistence/knowledge-types";
import { sendStructuredMessage, structuredMentionsFromEvents, type MentionResolution } from "../../src/message-bus/collaboration";
import { buildContentBlockEvent, buildPlainTextEvent, type MessageInputEvent } from "../../src/message-bus/message-events";
import type { RoleDefinition } from "../../src/roles";
import type { AgentCapability } from "../../src/agent/capability";

function mockCapability(): { systemPrompt: string; capability: AgentCapability } {
  return {
    systemPrompt: "system prompt",
    capability: {
      systemPrompt: "system prompt",
      skills: [],
      mcpServers: [],
      hooks: [],
      permissions: { defaultMode: "ask", rules: {} },
      tools: [],
      subAgents: [],
    },
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DATA_DIR = path.join(__dirname, "..", "..", "data");
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

const snails: Partial<Record<RoleName, RoleDefinition>> = {
  "Boss Role": buildSnail("Boss Role"),
  "Owner Snail": buildSnail("Owner Snail"),
  "Product Snail": buildSnail("Product Snail"),
  "Design Snail": buildSnail("Design Snail"),
  "研发者": buildSnail("研发者"),
  "检视者": buildSnail("检视者"),
  "知识执行者": buildSnail("知识执行者"),
};

main().catch((error) => {
  throw error;
});

async function main(): Promise<void> {
  await testStreamedEventsCompleteWithoutReturnText();
  await testBossMessageDefaultsToLatestRespondingRole();
  await testBossMessageFallsBackToDefaultWithoutLatestRespondingRole();
  await testExplicitMentionOverridesLatestRespondingRole();
  await testAskerSnailOverridesLatestRespondingRole();
  await testLatestRespondingRoleIgnoresDefaultMessageLimitAndNonRespondingSenders();
  await testKnowledgeGovernanceAtMentionFallbackIncludesSyntheticRole();
  await testAgentMessageWithoutMentionDoesNotFallbackToDefault();
  await testStreamedJsonStillRoutesStructuredMentions();
  await testBossMentionNoticeDoesNotDuplicateMessageBody();
  await testToolResultMessageOutDoesNotRouteAsMessageContent();
  await testSameRoundMentionsDispatchInParallel();
  await testDispatchInboxUsesLastContextCutoff();
  await testDispatchInboxUsesCutoffMessageIdTieBreaker();
  await testParallelDispatchRespectsRemainingRoundBudget();
  await testForcedWrapUpDispatchesDoNotRunInParallel();
  await testRuntimeFailureDoesNotConsumeDispatch();
  await testInterruptedRuntimeConsumesDispatchAfterMessageStarts();
  await testInterruptedRuntimePersistsStopDetailAndClearsForcedSession();
  await testSystemTimeoutPersistsFailedStopDetailAndClearsSession();
  await testInterruptedParallelRuntimeDoesNotAbortOtherMessages();
  await testMessageContextCutoffUsesMessageIds();

  console.log("collaboration tests passed");
}

async function testBossMessageDefaultsToLatestRespondingRole(): Promise<void> {
  const { store, conversation } = createContext("latest-responding-snail");
  store.addMessage({ conversationId: conversation.id, fromRole: "Product Snail", toRoles: [], role: "assistant", runtime: "system", status: "completed" });

  await sendStructuredMessage(buildDeps(store, conversation), conversation.id, [buildPlainTextEvent("继续")], 1);

  const userMessage = latestUserMessage(store, conversation.id);
  assert(userMessage?.to_roles.length === 1 && userMessage.to_roles[0] === "Product Snail", "boss message without explicit target should route to the latest responding snail");
  store.close();
}

async function testBossMessageFallsBackToDefaultWithoutLatestRespondingRole(): Promise<void> {
  const { store, conversation } = createContext("latest-responding-fallback");
  store.addMessage({ conversationId: conversation.id, fromRole: null, toRoles: [], role: "system", runtime: "system", status: "completed" });
  store.addMessage({ conversationId: conversation.id, fromRole: "Boss Role", toRoles: [], role: "user", runtime: "system", status: "completed" });

  await sendStructuredMessage(buildDeps(store, conversation), conversation.id, [buildPlainTextEvent("继续")], 1);

  const userMessage = latestUserMessage(store, conversation.id);
  assert(userMessage?.to_roles.length === 1 && userMessage.to_roles[0] === "Owner Snail", "boss message should fall back to default snail when no responding snail exists");
  store.close();
}

async function testExplicitMentionOverridesLatestRespondingRole(): Promise<void> {
  const { store, conversation } = createContext("latest-responding-explicit");
  store.addMessage({ conversationId: conversation.id, fromRole: "Product Snail", toRoles: [], role: "assistant", runtime: "system", status: "completed" });

  await sendStructuredMessage(buildDeps(store, conversation), conversation.id, [{ kind: "text", payload: { text: "请 Design Snail 看一下", mentions: ["Design Snail"] } }], 1);

  const userMessage = latestUserMessage(store, conversation.id);
  assert(userMessage?.to_roles.length === 1 && userMessage.to_roles[0] === "Design Snail", "explicit mention should override latest responding snail routing");
  store.close();
}

async function testAskerSnailOverridesLatestRespondingRole(): Promise<void> {
  const { store, conversation } = createContext("latest-responding-asker");
  store.addMessage({ conversationId: conversation.id, fromRole: "Product Snail", toRoles: [], role: "assistant", runtime: "system", status: "completed" });

  await sendStructuredMessage(buildDeps(store, conversation), conversation.id, [buildPlainTextEvent("回答问题卡片")], 1, { askerRole: "Design Snail" });

  const userMessage = latestUserMessage(store, conversation.id);
  assert(userMessage?.to_roles.length === 1 && userMessage.to_roles[0] === "Design Snail", "askerSnail should override latest responding snail routing");
  store.close();
}

async function testLatestRespondingRoleIgnoresDefaultMessageLimitAndNonRespondingSenders(): Promise<void> {
  const { store, conversation } = createContext("latest-responding-over-100");
  store.addMessage({ conversationId: conversation.id, fromRole: "Design Snail", toRoles: [], role: "assistant", runtime: "system", status: "completed" });
  store.addMessage({ conversationId: conversation.id, fromRole: "Boss Role", toRoles: [], role: "assistant", runtime: "system", status: "completed" });
  for (let index = 0; index < 120; index += 1) {
    store.addMessage({ conversationId: conversation.id, fromRole: "Boss Role", toRoles: [], role: "user", runtime: "system", status: "completed" });
  }

  await sendStructuredMessage(buildDeps(store, conversation), conversation.id, [buildPlainTextEvent("翻过很多历史后继续")], 1);

  const userMessage = latestUserMessage(store, conversation.id);
  assert(userMessage?.to_roles.length === 1 && userMessage.to_roles[0] === "Design Snail", "latest responding snail lookup must not depend on getMessages default limit and must ignore Boss Role");
  store.close();
}

async function testKnowledgeGovernanceAtMentionFallbackIncludesSyntheticRole(): Promise<void> {
  const { store, conversation } = createKnowledgeGovernanceContext("governance-at-mention-fallback");
  const captured: Array<{ name: string }> = [];
  const roles = store.listRoleDefinitionsByProject("knowledge-center");

  const deps = {
    ...buildDeps(store, conversation),
    resolveRole: (roleName: string) => roles.find((r) => r.name === roleName),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      const messageText = messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n");
      captured.push(...currentConversation.participating_roles.map((roleName) => ({ name: roleName })));
      return {
        messageText,
        mentions: [{ roleName: "知识执行者", raw: "@知识执行者", source: "llm_fallback" as const }],
      };
    },
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("@知识执行者 请处理")], 1);

  const userMessage = latestUserMessage(store, conversation.id);
  assert(captured.some((item) => item.name === "知识执行者"), "knowledge governance fallback candidates should include synthetic role names");
  assert(userMessage?.to_roles.length === 1 && userMessage.to_roles[0] === "知识执行者", "knowledge governance @ fallback should route to synthetic role");
  const executorRole = roles.find((r) => r.name === "知识执行者")!;
  assert(executorRole, "knowledge executor role should exist in DB seed");
  assert(executorRole.project_id === "knowledge-center", "knowledge executor role should belong to knowledge-center project");
  assert(executorRole.description.length > 0, "knowledge executor role should have non-empty description from DB seed");
  assert(executorRole.working_rules.length > 0, "knowledge executor role should have non-empty working_rules from DB seed");
  store.close();
}
async function testMessageContextCutoffUsesMessageIds(): Promise<void> {
  const { store, conversation } = createContext("context-cutoff-id");
  const previous = store.addMessage({ conversationId: conversation.id, fromRole: "Product Snail", toRoles: [], role: "assistant", runtime: "system", status: "completed" });

  await sendStructuredMessage({
    ...buildDeps(store, conversation),
    resolveRuntimeByRole: () => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent("已处理") });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
  }, conversation.id, [{ kind: "text", payload: { text: "请处理这个问题", mentions: ["Owner Snail"] } }], 1);

  const messages = store.getMessages(conversation.id);
  const userMessage = messages.find((message) => message.role === "user" && message.from_role === "Boss Role");
  const assistantMessage = messages.find((message) => message.role === "assistant" && message.from_role === "Owner Snail");
  assert(userMessage?.context_cutoff_at === String(previous.id), "user message cutoff should point at the previously visible message id");
  assert(assistantMessage?.context_cutoff_at === String(userMessage?.id), "assistant reply cutoff should point at the consumed source message id");

  const emptySystemStore = createContext("context-cutoff-empty-system");
  const systemMessage = emptySystemStore.store.addMessage({ conversationId: emptySystemStore.conversation.id, fromRole: null, toRoles: [], role: "system", runtime: "system", status: "completed" });
  assert(systemMessage.context_cutoff_at === "0", "store fallback cutoff should be message id zero rather than current time");
  emptySystemStore.store.close();
  store.close();
}

async function testInterruptedRuntimePersistsStopDetailAndClearsForcedSession(): Promise<void> {
  const { store, conversation } = createContext("runtime-interrupted-with-detail");
  const detail = buildStopDetail("user_interrupt", true);
  let clearedSession = false;
  store.createSnailAgentSession({ id: "test-session", conversationId: conversation.id, roleName: "Owner Snail", runtime: "opencode-cli", model: "test", contextProvider: "agent", externalSessionId: "stale-session" });

  const result = await sendStructuredMessage({
    ...buildDeps(store, conversation),
    resolveRuntimeByRole: () => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent("部分输出") });
        throw new AgentInvocationInterruptedError("Agent invocation interrupted", detail);
      },
      runtime: "opencode-cli" as const,
    }),
    updateSnailAgentSessionExternalId: (_sessionId: string, externalSessionId: string | null) => {
      if (externalSessionId === null) clearedSession = true;
    },
  }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);

  const assistant = store.getMessages(conversation.id).find((message) => message.role === "assistant");
  const terminal = assistant?.events.find((event) => event.kind === "signal" && event.payload.type === "message_interrupted");
  if (terminal?.kind !== "signal") throw new Error("interrupted terminal event should be a signal");
  assert(result.messageIds.includes(assistant?.id ?? -1), "interrupted result should include assistant message id");
  assert(assistant?.status === "interrupted", "user stop should persist interrupted status");
  assert(terminal?.payload.detail?.reason === "user_interrupt", "interrupted terminal signal should retain stop reason");
  assert(terminal?.payload.detail?.forced === true, "interrupted terminal signal should retain forced stop marker");
  assert(clearedSession, "forced interrupted stateful runtime should invalidate stale session");
  store.close();
}

async function testSystemTimeoutPersistsFailedStopDetailAndClearsSession(): Promise<void> {
  const { store, conversation } = createContext("runtime-timeout-with-detail");
  const detail = buildStopDetail("system_timeout", true);
  let clearedSession = false;
  let failed = false;
  store.createSnailAgentSession({ id: "test-session-timeout", conversationId: conversation.id, roleName: "Owner Snail", runtime: "opencode-cli", model: "test", contextProvider: "agent", externalSessionId: "stale-session" });

  try {
    await sendStructuredMessage({
      ...buildDeps(store, conversation),
      resolveRuntimeByRole: () => ({
        invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          onEvent({ type: "message_event", event: buildPlainTextEvent("准备执行") });
          throw new AgentInvocationTerminatedError("Owner Snail invocation stopped: system_timeout", detail);
        },
        runtime: "opencode-cli" as const,
      }),
      updateSnailAgentSessionExternalId: (_sessionId: string, externalSessionId: string | null) => {
        if (externalSessionId === null) clearedSession = true;
      },
    }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
  } catch (error) {
    failed = error instanceof AgentInvocationTerminatedError;
  }

  const assistant = store.getMessages(conversation.id).find((message) => message.role === "assistant");
  const terminal = assistant?.events.find((event) => event.kind === "signal" && event.payload.type === "message_failed");
  if (terminal?.kind !== "signal") throw new Error("failed terminal event should be a signal");
  assert(failed, "system timeout should still fail the send request");
  assert(assistant?.status === "failed", "system timeout should persist failed status");
  assert(terminal?.payload.detail?.reason === "system_timeout", "failed terminal signal should retain timeout reason");
  assert(clearedSession, "system timeout should invalidate stateful runtime session");
  store.close();
}

async function testInterruptedRuntimeConsumesDispatchAfterMessageStarts(): Promise<void> {
  const { store, conversation } = createContext("runtime-interrupted");
  const controller = new AbortController();

  const result = await sendStructuredMessage({
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: () => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent("已经输出一部分") });
        controller.abort();
        await Promise.resolve();
        if (options?.signal?.aborted) throw new AgentInvocationInterruptedError();
        throw new Error("test did not propagate abort signal");
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => controller,
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);

  const dispatches = store.listDispatches(conversation.id);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  assert(result.messageIds.length === 2 && result.messageIds.includes(assistantMessages[0]?.id ?? -1), "controlled interruption should return created message ids instead of failing the send request");
  assert(assistantMessages.length === 1 && assistantMessages[0]?.status === "interrupted", "interrupted runtime reply should be persisted as interrupted");
  assert(dispatches.length === 1 && dispatches[0]?.status === "consumed" && dispatches[0]?.consumed_by_message_id === assistantMessages[0]?.id, "interrupted runtime must keep the bus delivery consumed once the snail message has started");
  assert(assistantMessages[0]?.events.some((event) => event.kind === "signal" && event.payload?.type === "message_interrupted"), "interrupted message should record a terminal interrupted signal");
  store.close();
}

async function testInterruptedParallelRuntimeDoesNotAbortOtherMessages(): Promise<void> {
  const { store, conversation } = createContext("parallel-interrupt-isolation");
  const controllers: AbortController[] = [];
  const started: RoleName[] = [];

  const result = await sendStructuredMessage({
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => {
        started.push(snail.name as RoleName);
        await waitFor(() => started.length === 2);
        if (snail.name === "Owner Snail") controllers[0]?.abort();
        await Promise.resolve();
        if (options?.signal?.aborted) throw new AgentInvocationInterruptedError();
        onEvent({ type: "message_event", event: buildPlainTextEvent(`${snail.name} completed`) });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller;
    },
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  }, conversation.id, [{ kind: "text", payload: { text: "并行处理中断", mentions: ["Owner Snail", "Product Snail"] } }], 2);

  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  assert(result.messageIds.length === 3 && assistantMessages.every((message) => result.messageIds.includes(message.id)), "parallel interruption should wait for all started messages and return their ids");
  assert(assistantMessages.some((message) => message.from_role === "Owner Snail" && message.status === "interrupted"), "targeted parallel message should be interrupted");
  assert(assistantMessages.some((message) => message.from_role === "Product Snail" && message.status === "completed"), "non-target parallel message must not share the interrupted signal");
  store.close();
}

async function testStreamedEventsCompleteWithoutReturnText(): Promise<void> {
  const { store, conversation } = createContext("success");
  const result = await sendStructuredMessage({
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent(`流式回复来自 ${snail.name}`) });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);

  const messages = store.getMessages(conversation.id);
  assert(result.messageIds.length === 2, "sendStructuredMessage should return created message ids");
  assert(messages.some((message) => message.id === result.messageIds[1] && message.events.some((event) => event.kind === "text")), "agent text should be persisted as message events");
  store.close();
}

async function testAgentMessageWithoutMentionDoesNotFallbackToDefault(): Promise<void> {
  const { store, conversation } = createContext("agent-no-default-fallback");
  const calls: RoleName[] = [];
  const deps = {
    ...buildDeps(store, conversation),
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        calls.push(snail.name as RoleName);
        onEvent({ type: "message_event", event: buildPlainTextEvent("检视已完成，需要研发者处理但没有显式 mention") });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 3);

  const assistant = store.getMessages(conversation.id).find((message) => message.role === "assistant");
  assert(calls.length === 1 && calls[0] === "Owner Snail", "agent message without explicit mention should not trigger another default snail turn");
  assert(assistant?.to_roles.length === 0, "agent messages must rely on explicit mentions instead of fallback routing");
  store.close();
}

async function testRuntimeFailureDoesNotConsumeDispatch(): Promise<void> {
  const { store, conversation } = createContext("runtime-failure");
  let failed = false;

  try {
    await sendStructuredMessage({
      store,
      emitAgentEvent: () => undefined,
      buildConversationSystemPrompt: () => mockCapability(),
      resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
        const currentConversation = store.getConversation(conversation.id);
        if (!currentConversation) throw new Error("missing conversation");
        const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
        return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
      },
      refreshConversationSummary: async () => undefined,
      resolveRole: (roleName: RoleName) => snails[roleName],
      resolveRuntimeByRole: () => ({
        invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          onEvent({ type: "message_event", event: buildPlainTextEvent("准备执行") });
          onEvent({ type: "message_failure", error: "Claude Code denied required tool approval (ExitPlanMode). The agent did not continue execution." });
          return {};
        },
        runtime: "opencode-cli" as const,
      }),
      lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
      createInterruptController: () => new AbortController(),
      bindInterruptMessage: () => undefined,
      finishInterruptMessage: () => undefined,
    }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
  } catch (error) {
    failed = true;
    assert(error instanceof Error && error.message.includes("ExitPlanMode"), "runtime failure should propagate to the caller");
  }

  const dispatches = store.listDispatches(conversation.id);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  assert(failed, "sendStructuredMessage should fail when runtime reports terminal failure");
  assert(assistantMessages.length === 1 && assistantMessages[0]?.status === "failed", "failed runtime reply should be persisted as a failed message");
  assert(dispatches.length === 1 && dispatches[0]?.status === "consumed" && dispatches[0]?.consumed_by_message_id === assistantMessages[0]?.id, "runtime failure after message start must still consume the delivered dispatch");
  store.close();
}

async function testStreamedJsonStillRoutesStructuredMentions(): Promise<void> {
  const { store, conversation } = createContext("streamed-json-mentions");
  const calls: RoleName[] = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        calls.push(snail.name as RoleName);
        const payload = snail.name === "Owner Snail"
          ? JSON.stringify({ format: "blocks", fallback_text: "请 Product 继续", blocks: [{ type: "text", text: "请 Product 继续", mentions: ["Product Snail"] }] })
          : JSON.stringify({ format: "blocks", fallback_text: "收到", blocks: [{ type: "text", text: "收到", mentions: [] }] });
        onEvent({ type: "message_event", event: { kind: "text", payload: { text: payload.slice(0, 10), mentions: [] } } });
        onEvent({ type: "message_event", event: { kind: "text", payload: { text: payload.slice(10), mentions: [] } } });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 3);

  assert(calls.includes("Owner Snail"), "default snail should handle the initial boss message");
  assert(calls.includes("Product Snail"), "structured mentions from final JSON should route even when text was streamed in chunks");
  store.close();
}

async function testToolResultMessageOutDoesNotRouteAsMessageContent(): Promise<void> {
  const { store, conversation } = createContext("tool-result-message-out");
  const calls: RoleName[] = [];
  const payload = JSON.stringify({ format: "blocks", fallback_text: "请 Product 继续", blocks: [{ type: "text", text: "请 Product 继续", mentions: ["Product Snail"] }] });
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        calls.push(snail.name as RoleName);
        onEvent({ type: "message_event", event: { kind: "tool_call", payload: { tool_name: "bash", call_id: "call-1", input: { command: "message-out" }, title: null } } });
        onEvent({ type: "message_event", event: { kind: "tool_result", payload: { tool_name: "bash", call_id: "call-1", is_error: false, output_text: payload, error_text: null, metadata: { status: "completed" } } } });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  const result = await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 3);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  const assistantEvents = assistantMessages.flatMap((message) => message.events);

  assert(calls.length === 1 && calls[0] === "Owner Snail", "message-out inside tool_result must not route mentions as message content");
  assert(result.messageIds.length === 2, "tool_result-only output should still return created message ids");
  assert(!assistantEvents.some((event) => event.kind === "content_block"), "tool_result message-out payload must not be appended as a content_block event");
  store.close();
}

async function testBossMentionNoticeDoesNotDuplicateMessageBody(): Promise<void> {
  const { store, conversation } = createContext("boss-mention-notice");
  const noisyMessage = "这是一段很长的实现说明，不应该被复制进系统提醒";
  const deps = {
    ...buildDeps(store, conversation),
    resolveRuntimeByRole: () => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildContentBlockEvent([{ type: "text", text: noisyMessage, mentions: ["Boss Role"] }], noisyMessage) });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 2);

  const systemTexts = store.getMessages(conversation.id)
    .filter((message) => message.role === "system")
    .flatMap((message) => message.events)
    .filter((event) => event.kind === "text")
    .map((event) => event.payload.text);
  const bossDispatch = store.listDispatches(conversation.id).find((dispatch) => dispatch.to_role === "Boss Role");

  assert(systemTexts.includes("有消息 mention 到老大，等待人工回复。"), "boss mention notice should only remind that manual reply is needed");
  assert(systemTexts.every((text) => !text.includes(noisyMessage)), "boss mention notice must not duplicate the mentioned message body");
  assert(bossDispatch?.status === "skipped", "boss dispatch should still be skipped instead of invoking a human snail");
  store.close();
}

async function testSameRoundMentionsDispatchInParallel(): Promise<void> {
  const { store, conversation } = createContext("parallel-dispatch");
  const started: RoleName[] = [];
  const release: Array<() => void> = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        started.push(snail.name as RoleName);
        await new Promise<void>((resolve) => release.push(resolve));
        onEvent({ type: "message_event", event: buildPlainTextEvent(`${snail.name} done`) });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  const sendPromise = sendStructuredMessage(
    deps,
    conversation.id,
    [{ kind: "text", payload: { text: "并行处理", mentions: ["Owner Snail", "Product Snail", "Design Snail"] } }],
    3
  );

  await waitFor(() => started.length === 3);
  assert(started.includes("Owner Snail"), "Owner Snail should start in the first bus round");
  assert(started.includes("Product Snail"), "Product Snail should start in the first bus round");
  assert(started.includes("Design Snail"), "Design Snail should start in the first bus round");
  release.forEach((resolve) => resolve());
  await sendPromise;
  store.close();
}

async function testDispatchInboxUsesLastContextCutoff(): Promise<void> {
  const { store, conversation } = createContext("dispatch-cutoff-inbox");
  const seenIncremental: Partial<Record<RoleName, string[]>> = {};
  const deps = {
    ...buildDeps(store, conversation),
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        seenIncremental[snail.name as RoleName] = input.incrementalMessages.map((message) => message.context?.context ?? message.events.map((item) => item.kind === "text" ? item.payload.text : "").join(""));
        const event = snail.name === "Product Snail"
          ? buildPlainTextEvent("Product 完成")
          : buildContentBlockEvent([{ type: "text", text: "请 Product 继续", mentions: ["Product Snail"] }], "请 Product 继续");
        onEvent({ type: "message_event", event });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("第一次请求")], 2);
  await sendStructuredMessage(deps, conversation.id, [{ kind: "text", payload: { text: "第二次请求", mentions: ["Owner Snail"] } }], 2);

  const productMessages = seenIncremental["Product Snail"] ?? [];
  assert(productMessages.some((text) => text.includes("请 Product 继续")), "target snail must receive dispatch source created after its previous context cutoff");
  assert(productMessages.some((text) => text.includes("第二次请求")), "target snail must still receive the direct boss source message for this pending dispatch");
  assert(!productMessages.some((text) => text.includes("Product 完成")), "target snail should not receive its own previous reply as incremental input");
  store.close();
}

async function testDispatchInboxUsesCutoffMessageIdTieBreaker(): Promise<void> {
  const { store, conversation } = createContext("dispatch-cutoff-message-id");
  const cutoffMessage = store.addMessage({ conversationId: conversation.id, fromRole: "Boss Role", toRoles: [], role: "user", runtime: "system", status: "completed", contextCutoffAt: "0" });
  const missedNonSource = store.addMessage({ conversationId: conversation.id, fromRole: "Product Snail", toRoles: [], role: "assistant", runtime: "system", status: "completed", contextCutoffAt: "0" });
  const previousOwnerReply = store.addMessage({ conversationId: conversation.id, fromRole: "Owner Snail", toRoles: [], role: "assistant", runtime: "system", status: "completed", contextCutoffAt: String(cutoffMessage.id) });
  const directSource = store.addMessage({ conversationId: conversation.id, fromRole: "Boss Role", toRoles: ["Owner Snail"], role: "user", runtime: "system", status: "completed", contextCutoffAt: "0" });

  const inbox = store.getDispatchInboxMessages(conversation.id, "Owner Snail", [directSource.id]);
  const inboxIds = inbox.map((message) => message.id);

  assert(inboxIds.includes(missedNonSource.id), "non-source messages written after the cutoff message in the same second must remain unread");
  assert(inboxIds.includes(directSource.id), "direct dispatch source must remain included in the inbox");
  assert(!inboxIds.includes(cutoffMessage.id), "messages at or before the precise cutoff id must stay excluded");
  assert(!inboxIds.includes(previousOwnerReply.id), "target snail must not receive its own previous reply as incremental input");
  store.close();
}

async function testParallelDispatchRespectsRemainingRoundBudget(): Promise<void> {
  const { store, conversation } = createContext("parallel-round-budget");
  const calls: Array<{ role: RoleName; forcedWrapUp: boolean; mentionAllowed: boolean; remainingRounds: number }> = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: (_conversationId: string, options: { activeRoleName: RoleName; forcedWrapUp: boolean; mentionAllowed: boolean; remainingRounds: number }) => {
      calls.push({ role: options.activeRoleName, forcedWrapUp: options.forcedWrapUp, mentionAllowed: options.mentionAllowed, remainingRounds: options.remainingRounds });
      return mockCapability();
    },
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent(`${snail.name} done`) });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  await sendStructuredMessage(
    deps,
    conversation.id,
    [{ kind: "text", payload: { text: "并行处理", mentions: ["Owner Snail", "Product Snail", "Design Snail"] } }],
    1
  );

  assert(calls.length === 3, "all pending batches should eventually be processed or wrapped up");
  assert(calls[0]?.remainingRounds === 1 && calls[0]?.mentionAllowed && !calls[0]?.forcedWrapUp, "first agent batch should consume the only remaining collaboration round");
  assert(calls.slice(1).every((call) => call.remainingRounds === 0 && !call.mentionAllowed && call.forcedWrapUp), "overflow batches should run only after the budget is exhausted and must be forced wrap-up");
  store.close();
}

async function testForcedWrapUpDispatchesDoNotRunInParallel(): Promise<void> {
  const { store, conversation } = createContext("forced-wrap-up-serial");
  const started: RoleName[] = [];
  const release: Array<() => void> = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: (snail: RoleDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        started.push(snail.name as RoleName);
        await new Promise<void>((resolve) => release.push(resolve));
        onEvent({ type: "message_event", event: buildPlainTextEvent(`${snail.name} done`) });
        return {};
      },
      runtime: "opencode-cli" as const,
    }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  const sendPromise = sendStructuredMessage(
    deps,
    conversation.id,
    [{ kind: "text", payload: { text: "请收口", mentions: ["Owner Snail", "Product Snail", "Design Snail"] } }],
    0
  );

  await waitFor(() => started.length === 1);
  await waitBriefly();
  assert(started.length === 1, "forced wrap-up should not start multiple default snail invocations in parallel");

  release.shift()?.();
  await waitFor(() => started.length === 2);
  await waitBriefly();
  assert(started.length === 2, "second forced wrap-up should complete before the third starts");

  release.shift()?.();
  await waitFor(() => started.length === 3);
  release.shift()?.();
  await sendPromise;
  assert(started.every((roleName) => roleName === "Owner Snail"), "forced wrap-up dispatches should run as the default snail");
  store.close();
}

function createContext(suffix: string): { store: ConversationStore; conversation: ReturnType<ConversationStore["createConversation"]> } {
  const dbPath = path.join(TEST_DATA_DIR, `test-collaboration-${suffix}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const store = new ConversationStore(dbPath);
  const projectId = `project-collaboration-${suffix}`;
  store.seedProjectConfigs([{
    project: { id: projectId, kind: "system_self", module: "project_management", name: "Snail Shell", summary: "Collaboration test" },
    stage_definitions: [
      { id: `${projectId}-sd-dev`, key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "交付", acceptance_focus: [], roles: [{ id: `${projectId}-sr-impl`, name: "研发者", snail_template_id: "opencode-default", is_primary: true, description: "", working_rules: [] }] },
    ],
  }, {
    project: { id: "knowledge-center", kind: "system_self", module: "knowledge_governance", name: "Knowledge Center", summary: "知识中心内置项目" },
    stage_definitions: [
      { id: "knowledge-center-development", key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "完成候选知识治理", acceptance_focus: [], roles: [{ id: "kc-sr-boss", name: "Boss Role", snail_template_id: "opencode-default", is_primary: true, description: "最终决策者，确认治理结论", working_rules: ["以数据为依据做决策", "治理结论需明确落地入口"] }, { id: "kc-sr-executor", name: "知识执行者", snail_template_id: "opencode-default", is_primary: false, description: "负责执行知识治理流程：入口校验、查重、裁决去向跟踪", working_rules: ["严格按入口校验流程", "查重需覆盖全局知识库", "裁决去向必须明确并记录PR链接"] }] },
    ],
  }]);
  const project = store.getProject(projectId)!;
  const feature = store.createFeature({ id: `feature-collaboration-${suffix}`, projectId: project.id, title: "Collaboration", summary: "test" });
  const stage = store.createStage({ id: `stage-collaboration-${suffix}`, projectId: project.id, featureId: feature.id, stageDefinitionId: `${projectId}-sd-dev`, type: "development", sequence: 1, status: "in_progress", enteredAt: new Date().toISOString() });
  const conversation = store.createConversation({ id: `conversation-collaboration-${suffix}`, projectId: project.id, featureId: feature.id, stageId: stage.id, title: "Collaboration", kind: "discussion", defaultRole: "Owner Snail", participatingRoles: ["Boss Role", "Owner Snail", "Product Snail", "Design Snail"], fromConversationIds: [] });
  return { store, conversation };
}

function createKnowledgeGovernanceContext(suffix: string): { store: ConversationStore; knowledge: KnowledgeWithDetails; conversation: Conversation } {
  const dbPath = path.join(TEST_DATA_DIR, `test-collaboration-${suffix}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const store = new ConversationStore(dbPath);
  const project = store.createProject(`project-collaboration-${suffix}`, "system_self", "project_management", "Snail Shell", "Collaboration test");
  store.seedProjectConfigs([{
    project: { id: "knowledge-center", kind: "system_self", module: "knowledge_governance", name: "Knowledge Center", summary: "知识中心内置项目" },
    stage_definitions: [
      { id: "knowledge-center-development", key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "完成候选知识治理", acceptance_focus: [], roles: [{ id: "kc-sr-boss", name: "Boss Role", snail_template_id: "opencode-default", is_primary: true, description: "最终决策者，确认治理结论", working_rules: ["以数据为依据做决策", "治理结论需明确落地入口"] }, { id: "kc-sr-executor", name: "知识执行者", snail_template_id: "opencode-default", is_primary: false, description: "负责执行知识治理流程：入口校验、查重、裁决去向跟踪", working_rules: ["严格按入口校验流程", "查重需覆盖全局知识库", "裁决去向必须明确并记录PR链接"] }] },
    ],
  }]);
  const knowledge = store.createKnowledge({ id: `knowledge-collaboration-${suffix}`, projectId: project.id, scopeType: "project", scopeRef: project.id, kind: "rule", title: "治理对话路由", content: "测试治理对话默认回复上一发言 Snail。" });
  const governanceConversation = knowledge.governance?.conversation;
  if (!governanceConversation) throw new Error("knowledge governance conversation should exist");
  const conversation = store.getConversation(governanceConversation.id);
  if (!conversation) throw new Error("knowledge governance conversation should be readable through the store facade");
  return { store, knowledge, conversation };
}

function latestUserMessage(store: ConversationStore, conversationId: string) {
  return store.getLatestMessage(conversationId)?.role === "user" ? store.getLatestMessage(conversationId) : store.getMessages(conversationId, 200).filter((message) => message.role === "user").at(-1);
}

function buildDeps(store: ConversationStore, conversation: ReturnType<ConversationStore["createConversation"]>) {
  return {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => mockCapability(),
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveRole: (roleName: RoleName) => snails[roleName],
    resolveRuntimeByRole: () => ({ invokeMessage: async () => ({}), runtime: "opencode-cli" as const }),
    lookupOrCreateSnailAgentSession: () => ({ id: "test-session", conversation_id: conversation.id, role_name: "Owner Snail", runtime: "opencode-cli", model: "test-model", context_provider: "agent" as const, external_session_id: null, handoff_from_id: null, created_at: new Date().toISOString() }),
    updateSnailAgentSessionExternalId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };
}

function buildStopDetail(reason: AgentStopDetail["reason"], forced: boolean): AgentStopDetail {
  return {
    reason,
    phase: forced ? "kill_sent" : "closed",
    requested_at: new Date().toISOString(),
    closed_at: forced ? null : new Date().toISOString(),
    graceful_timeout_ms: 10,
    terminate_timeout_ms: 10,
    kill_confirm_timeout_ms: 10,
    forced,
    exit_code: null,
    exit_signal: forced ? "SIGKILL" : "SIGINT",
    process_group_signal_attempted: forced,
    process_group_signal_error: null,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) throw new Error("timed out waiting for parallel dispatches");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitBriefly(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function buildSnail(name: RoleName): RoleDefinition {
  return {
    id: `sr-${name.toLowerCase().replace(/\s+/g, "-")}`,
    project_id: "project-test",
    stage_definition_id: "sd-test",
    name,
    snail_template_id: "opencode-default",
    is_primary: 1,
    description: `${name} test snail`,
    working_rules: [],
    created_at: "",
    updated_at: "",
  };
}
