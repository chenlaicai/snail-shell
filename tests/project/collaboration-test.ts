import fs from "fs";
import path from "path";
import { AgentInvocationInterruptedError, AgentInvocationTerminatedError, type AgentEvent, type AgentInvocationOptions, type AgentStopDetail, type SnailRuntimeMessageInput } from "../../src/agent/interface";
import { ConversationStore, type CreateMessageEventInput, type SnailName } from "../../src/persistence/store";
import { consumeSnailInbox, sendStructuredMessage, structuredMentionsFromEvents, type MentionResolution } from "../../src/project/collaboration";
import { buildPlainTextEvent, type MessageInputEvent } from "../../src/project/message-events";
import type { SnailDefinition } from "../../src/snails";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DATA_DIR = path.join(__dirname, "..", "..", "data");
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

const snails: Partial<Record<SnailName, SnailDefinition>> = {
  "Boss Snail": buildSnail("Boss Snail"),
  "Owner Snail": buildSnail("Owner Snail"),
  "Product Snail": buildSnail("Product Snail"),
  "Design Snail": buildSnail("Design Snail"),
};

main().catch((error) => {
  throw error;
});

async function main(): Promise<void> {
  await testStreamedEventsCompleteWithoutReturnText();
  await testStreamedJsonStillRoutesStructuredMentions();
  await testToolResultMessageOutDoesNotRouteAsMessageContent();
  await testSameRoundMentionsDispatchInParallel();
  await testParallelDispatchRespectsRemainingRoundBudget();
  await testForcedWrapUpDispatchesDoNotRunInParallel();
  await testDispatchInboxGroupsExposeConsumerState();
  await testRuntimeFailureDoesNotConsumeDispatch();
  await testInterruptedRuntimeConsumesDispatchAfterMessageStarts();
  await testInterruptedRuntimePersistsStopDetailAndClearsForcedSession();
  await testSystemTimeoutPersistsFailedStopDetailAndClearsSession();
  await testInterruptedParallelRuntimeDoesNotAbortOtherMessages();

  console.log("collaboration tests passed");
}

async function testInterruptedRuntimePersistsStopDetailAndClearsForcedSession(): Promise<void> {
  const { store, conversation } = createContext("runtime-interrupted-with-detail");
  const detail = buildStopDetail("user_interrupt", true);
  let clearedSession = false;
  store.updateConversation(conversation.id, { runtime_sessions: { "Owner Snail": { sessionId: "stale-session" } } });

  const deps = {
    ...buildDeps(store, conversation),
    resolveRuntimeBySnail: () => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent("部分输出") });
        throw new AgentInvocationInterruptedError("Agent invocation interrupted", detail);
      },
    }),
    updateConversationRuntimeSessionId: (_conversationId: string, snailName: SnailName, sessionId: string | null) => {
      if (snailName === "Owner Snail" && sessionId === null) clearedSession = true;
    },
  };
  const result = await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
  const consumed = await consumeSnailInbox(deps, conversation.id, "Owner Snail", 1);

  const assistant = store.getMessages(conversation.id).find((message) => message.role === "assistant");
  const terminal = assistant?.events.find((event) => event.kind === "signal" && event.payload.type === "message_interrupted");
  if (terminal?.kind !== "signal") throw new Error("interrupted terminal event should be a signal");
  assert(result.messageIds.length === 1 && result.messageIds[0] !== assistant?.id, "send should return only the produced user message id");
  assert(consumed.messageIds.includes(assistant?.id ?? -1), "interrupted consumer result should include assistant message id");
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
  store.updateConversation(conversation.id, { runtime_sessions: { "Owner Snail": { sessionId: "stale-session" } } });

  try {
    const deps = {
      ...buildDeps(store, conversation),
      resolveRuntimeBySnail: () => ({
        invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          onEvent({ type: "message_event", event: buildPlainTextEvent("准备执行") });
          throw new AgentInvocationTerminatedError("Owner Snail invocation stopped: system_timeout", detail);
        },
      }),
      updateConversationRuntimeSessionId: (_conversationId: string, snailName: SnailName, sessionId: string | null) => {
        if (snailName === "Owner Snail" && sessionId === null) clearedSession = true;
      },
    };
    await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
    await consumeSnailInbox(deps, conversation.id, "Owner Snail", 1);
  } catch (error) {
    failed = error instanceof AgentInvocationTerminatedError;
  }

  const assistant = store.getMessages(conversation.id).find((message) => message.role === "assistant");
  const terminal = assistant?.events.find((event) => event.kind === "signal" && event.payload.type === "message_failed");
  if (terminal?.kind !== "signal") throw new Error("failed terminal event should be a signal");
  assert(failed, "system timeout should fail the consumer run");
  assert(assistant?.status === "failed", "system timeout should persist failed status");
  assert(terminal?.payload.detail?.reason === "system_timeout", "failed terminal signal should retain timeout reason");
  assert(clearedSession, "system timeout should invalidate stateful runtime session");
  store.close();
}

async function testInterruptedRuntimeConsumesDispatchAfterMessageStarts(): Promise<void> {
  const { store, conversation } = createContext("runtime-interrupted");
  const controller = new AbortController();

  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: () => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent("已经输出一部分") });
        controller.abort();
        await Promise.resolve();
        if (options?.signal?.aborted) throw new AgentInvocationInterruptedError();
        throw new Error("test did not propagate abort signal");
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
    createInterruptController: () => controller,
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };
  const result = await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
  const consumed = await consumeSnailInbox(deps, conversation.id, "Owner Snail", 1);

  const dispatches = store.listDispatches(conversation.id);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  assert(result.messageIds.length === 1, "send should return before interrupted consumer finishes");
  assert(consumed.messageIds.includes(assistantMessages[0]?.id ?? -1), "controlled interruption should return created assistant ids from the consumer");
  assert(assistantMessages.length === 1 && assistantMessages[0]?.status === "interrupted", "interrupted runtime reply should be persisted as interrupted");
  assert(dispatches.length === 1 && dispatches[0]?.status === "consumed" && dispatches[0]?.consumed_by_message_id === assistantMessages[0]?.id, "interrupted runtime must keep the bus delivery consumed once the snail message has started");
  assert(assistantMessages[0]?.events.some((event) => event.kind === "signal" && event.payload?.type === "message_interrupted"), "interrupted message should record a terminal interrupted signal");
  store.close();
}

async function testInterruptedParallelRuntimeDoesNotAbortOtherMessages(): Promise<void> {
  const { store, conversation } = createContext("parallel-interrupt-isolation");
  const controllers: AbortController[] = [];
  const started: SnailName[] = [];

  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: (snail: SnailDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void, options?: AgentInvocationOptions) => {
        started.push(snail.name as SnailName);
        await waitFor(() => started.length === 2);
        if (snail.name === "Owner Snail") controllers[0]?.abort();
        await Promise.resolve();
        if (options?.signal?.aborted) throw new AgentInvocationInterruptedError();
        onEvent({ type: "message_event", event: buildPlainTextEvent(`${snail.name} completed`) });
        return {};
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
    createInterruptController: () => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller;
    },
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };
  const result = await sendStructuredMessage(deps, conversation.id, [{ kind: "text", payload: { text: "并行处理中断", mentions: ["Owner Snail", "Product Snail"] } }], 2);
  const consumedResults = await Promise.all([consumeSnailInbox(deps, conversation.id, "Owner Snail", 2), consumeSnailInbox(deps, conversation.id, "Product Snail", 2)]);

  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  const consumedIds = consumedResults.flatMap((item) => item.messageIds);
  assert(result.messageIds.length === 1, "send should not wait for parallel consumers");
  assert(assistantMessages.every((message) => consumedIds.includes(message.id)), "parallel consumers should return their created assistant ids");
  assert(assistantMessages.some((message) => message.from_snail === "Owner Snail" && message.status === "interrupted"), "targeted parallel message should be interrupted");
  assert(assistantMessages.some((message) => message.from_snail === "Product Snail" && message.status === "completed"), "non-target parallel message must not share the interrupted signal");
  store.close();
}

async function testStreamedEventsCompleteWithoutReturnText(): Promise<void> {
  const { store, conversation } = createContext("success");
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: (snail: SnailDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent(`流式回复来自 ${snail.name}`) });
        return {};
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };
  const result = await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
  const consumed = await consumeSnailInbox(deps, conversation.id, "Owner Snail", 1);

  const messages = store.getMessages(conversation.id);
  assert(result.messageIds.length === 1, "sendStructuredMessage should return only the produced message id");
  assert(messages.some((message) => message.id === consumed.messageIds[0] && message.events.some((event) => event.kind === "text")), "agent text should be persisted as message events by the consumer");
  store.close();
}

async function testRuntimeFailureDoesNotConsumeDispatch(): Promise<void> {
  const { store, conversation } = createContext("runtime-failure");
  let failed = false;
  const statusEvents: any[] = [];

  try {
    const deps = {
      store,
      emitAgentEvent: (_conversationId: string, event: Record<string, unknown>) => {
        if (event.type === "message_status_changed") statusEvents.push(event);
      },
      buildConversationSystemPrompt: () => "system prompt",
      resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
        const currentConversation = store.getConversation(conversation.id);
        if (!currentConversation) throw new Error("missing conversation");
        const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
        return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
      },
      refreshConversationSummary: async () => undefined,
      resolveSnail: (snailName: SnailName) => snails[snailName],
      resolveRuntimeBySnail: () => ({
        invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          onEvent({ type: "message_event", event: buildPlainTextEvent("准备执行") });
          onEvent({ type: "message_failure", error: "Claude Code denied required tool approval (ExitPlanMode). The agent did not continue execution." });
          return {};
        },
      }),
      updateConversationRuntimeSessionId: () => undefined,
      createInterruptController: () => new AbortController(),
      bindInterruptMessage: () => undefined,
      finishInterruptMessage: () => undefined,
    };
    await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
    await consumeSnailInbox(deps, conversation.id, "Owner Snail", 1);
  } catch (error) {
    failed = true;
    assert(error instanceof Error && error.message.includes("ExitPlanMode"), "runtime failure should propagate to the caller");
  }

  const dispatches = store.listDispatches(conversation.id);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  assert(failed, "consumer should fail when runtime reports terminal failure");
  assert(assistantMessages.length === 1 && assistantMessages[0]?.status === "failed", "failed runtime reply should be persisted as a failed message");
  assert(statusEvents.some((event) => event.error_text?.includes("ExitPlanMode")), "failed realtime status should include the terminal error text");
  assert(dispatches.length === 1 && dispatches[0]?.status === "consumed" && dispatches[0]?.consumed_by_message_id === assistantMessages[0]?.id, "runtime failure after message start must still consume the delivered dispatch");
  store.close();
}

async function testStreamedJsonStillRoutesStructuredMentions(): Promise<void> {
  const { store, conversation } = createContext("streamed-json-mentions");
  const calls: SnailName[] = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: (snail: SnailDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        calls.push(snail.name as SnailName);
        const payload = snail.name === "Owner Snail"
          ? JSON.stringify({ format: "blocks", fallback_text: "请 Product 继续", blocks: [{ type: "text", text: "请 Product 继续", mentions: ["Product Snail"] }] })
          : JSON.stringify({ format: "blocks", fallback_text: "收到", blocks: [{ type: "text", text: "收到", mentions: [] }] });
        onEvent({ type: "message_event", event: { kind: "text", payload: { text: payload.slice(0, 10), mentions: [] } } });
        onEvent({ type: "message_event", event: { kind: "text", payload: { text: payload.slice(10), mentions: [] } } });
        return {};
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 3);
  await consumeAllPending(deps, conversation.id, 3);

  assert(calls.includes("Owner Snail"), "default snail should handle the initial boss message");
  assert(calls.includes("Product Snail"), "structured mentions from final JSON should route even when text was streamed in chunks");
  store.close();
}

async function testToolResultMessageOutDoesNotRouteAsMessageContent(): Promise<void> {
  const { store, conversation } = createContext("tool-result-message-out");
  const calls: SnailName[] = [];
  const payload = JSON.stringify({ format: "blocks", fallback_text: "请 Product 继续", blocks: [{ type: "text", text: "请 Product 继续", mentions: ["Product Snail"] }] });
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: (snail: SnailDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        calls.push(snail.name as SnailName);
        onEvent({ type: "message_event", event: { kind: "tool_call", payload: { tool_name: "bash", call_id: "call-1", input: { command: "message-out" }, title: null } } });
        onEvent({ type: "message_event", event: { kind: "tool_result", payload: { tool_name: "bash", call_id: "call-1", is_error: false, output_text: payload, error_text: null, metadata: { status: "completed" } } } });
        return {};
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  const result = await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 3);
  await consumeAllPending(deps, conversation.id, 3);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  const assistantEvents = assistantMessages.flatMap((message) => message.events);

  assert(calls.length === 1 && calls[0] === "Owner Snail", "message-out inside tool_result must not route mentions as message content");
  assert(result.messageIds.length === 1, "send should return only the produced message id");
  assert(!assistantEvents.some((event) => event.kind === "content_block"), "tool_result message-out payload must not be appended as a content_block event");
  store.close();
}

async function testSameRoundMentionsDispatchInParallel(): Promise<void> {
  const { store, conversation } = createContext("parallel-dispatch");
  const started: SnailName[] = [];
  const release: Array<() => void> = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: (snail: SnailDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        started.push(snail.name as SnailName);
        await new Promise<void>((resolve) => release.push(resolve));
        onEvent({ type: "message_event", event: buildPlainTextEvent(`${snail.name} done`) });
        return {};
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  await sendStructuredMessage(deps, conversation.id, [{ kind: "text", payload: { text: "并行处理", mentions: ["Owner Snail", "Product Snail", "Design Snail"] } }], 3);
  const consumePromise = Promise.all([
    consumeSnailInbox(deps, conversation.id, "Owner Snail", 3),
    consumeSnailInbox(deps, conversation.id, "Product Snail", 3),
    consumeSnailInbox(deps, conversation.id, "Design Snail", 3),
  ]);

  await waitFor(() => started.length === 3);
  assert(started.includes("Owner Snail"), "Owner Snail should start in the first bus round");
  assert(started.includes("Product Snail"), "Product Snail should start in the first bus round");
  assert(started.includes("Design Snail"), "Design Snail should start in the first bus round");
  release.forEach((resolve) => resolve());
  await consumePromise;
  store.close();
}

async function testParallelDispatchRespectsRemainingRoundBudget(): Promise<void> {
  const { store, conversation } = createContext("parallel-round-budget");
  const calls: Array<{ snail: SnailName; forcedWrapUp: boolean; mentionAllowed: boolean; remainingRounds: number }> = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: (_conversationId: string, options: { activeSnailName: SnailName; forcedWrapUp: boolean; mentionAllowed: boolean; remainingRounds: number }) => {
      calls.push({ snail: options.activeSnailName, forcedWrapUp: options.forcedWrapUp, mentionAllowed: options.mentionAllowed, remainingRounds: options.remainingRounds });
      return "system prompt";
    },
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: (snail: SnailDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        onEvent({ type: "message_event", event: buildPlainTextEvent(`${snail.name} done`) });
        return {};
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
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
  await consumeAllPending(deps, conversation.id, 1);

  assert(calls.length === 3, "all initially generated dispatches should still be consumed by their target snails");
  assert(calls[0]?.remainingRounds === 1 && calls[0]?.mentionAllowed && !calls[0]?.forcedWrapUp, "first generated agent message should still see the original remaining count");
  assert(calls.slice(1).every((call) => call.remainingRounds === 0 && call.mentionAllowed && !call.forcedWrapUp), "round budget is now enforced when generated agent messages create follow-up dispatches, not while consumers read existing dispatches");
  store.close();
}

async function testForcedWrapUpDispatchesDoNotRunInParallel(): Promise<void> {
  const { store, conversation } = createContext("generated-round-limit");
  const calls: SnailName[] = [];
  const deps = {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: (snail: SnailDefinition) => ({
      invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
        calls.push(snail.name as SnailName);
        onEvent({ type: "message_event", event: { kind: "content_block", payload: { fallback_text: `${snail.name} 请求 Product 继续`, blocks: [{ type: "text", text: `${snail.name} 请求 Product 继续`, mentions: ["Product Snail"] }] } } });
        return {};
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
    createInterruptController: () => new AbortController(),
    bindInterruptMessage: () => undefined,
    finishInterruptMessage: () => undefined,
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
  await consumeSnailInbox(deps, conversation.id, "Owner Snail", 1);
  const pending = store.listPendingDispatches(conversation.id);

  assert(calls.length === 1 && calls[0] === "Owner Snail", "initial generated message should be consumed by the addressed snail");
  assert(pending.length === 1 && pending[0]?.to_snail === "Owner Snail" && pending[0]?.forced_wrap_up === 1, "follow-up mention at the generation limit should become a default snail wrap-up dispatch");
  store.close();
}

async function testDispatchInboxGroupsExposeConsumerState(): Promise<void> {
  const { store, conversation } = createContext("dispatch-state-groups");
  const userMessage = store.addMessage({ conversationId: conversation.id, fromSnail: "Boss Snail", toSnails: ["Owner Snail"], role: "user", runtime: "system", status: "completed" });
  const claimed = store.claimPendingDispatches(conversation.id, "Owner Snail", "claim-dispatch-state");
  store.createForcedWrapUpDispatch({ conversationId: conversation.id, sourceMessageId: userMessage.id, defaultSnail: "Owner Snail" });

  const groups = store.listDispatchInboxGroups(conversation.id);
  const claimedGroup = groups.find((group) => group.status === "claimed");
  const forcedGroup = groups.find((group) => group.status === "pending" && group.forced_wrap_up_count === 1);

  assert(claimed.length === 1 && claimedGroup?.to_snail === "Owner Snail", "dispatch state should expose claimed consumer work by target snail");
  assert(forcedGroup?.to_snail === "Owner Snail", "dispatch state should expose pending forced wrap-up dispatches");
  store.close();
}

function createContext(suffix: string): { store: ConversationStore; conversation: ReturnType<ConversationStore["createConversation"]> } {
  const dbPath = path.join(TEST_DATA_DIR, `test-collaboration-${suffix}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const store = new ConversationStore(dbPath);
  const project = store.createProject(`project-collaboration-${suffix}`, "system_self", "Snail Shell", "Collaboration test");
  const feature = store.createFeature({ id: `feature-collaboration-${suffix}`, projectId: project.id, title: "Collaboration", summary: "test" });
  const stage = store.createStage({ id: `stage-collaboration-${suffix}`, projectId: project.id, featureId: feature.id, type: "development", sequence: 1, status: "in_progress", formalArtifacts: [], enteredAt: new Date().toISOString() });
  const conversation = store.createConversation({ id: `conversation-collaboration-${suffix}`, projectId: project.id, featureId: feature.id, stageId: stage.id, title: "Collaboration", kind: "discussion", defaultSnail: "Owner Snail", participatingSnails: ["Boss Snail", "Owner Snail", "Product Snail", "Design Snail"], fromConversationIds: [] });
  return { store, conversation };
}

function buildDeps(store: ConversationStore, conversation: ReturnType<ConversationStore["createConversation"]>) {
  return {
    store,
    emitAgentEvent: () => undefined,
    buildConversationSystemPrompt: () => "system prompt",
    resolveMentions: async (_conversationId: string, events: CreateMessageEventInput[]): Promise<MentionResolution> => {
      const currentConversation = store.getConversation(conversation.id);
      if (!currentConversation) throw new Error("missing conversation");
      const messageEvents = events.filter((event): event is MessageInputEvent => event.kind === "text" || event.kind === "content_block");
      return { mentions: structuredMentionsFromEvents(currentConversation, messageEvents), messageText: messageEvents.map((event) => event.kind === "text" ? event.payload.text : event.payload.fallback_text ?? "").join("\n") };
    },
    refreshConversationSummary: async () => undefined,
    resolveSnail: (snailName: SnailName) => snails[snailName],
    resolveRuntimeBySnail: () => ({ invokeMessage: async () => ({}) }),
    updateConversationRuntimeSessionId: () => undefined,
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

async function consumeAllPending(deps: Parameters<typeof consumeSnailInbox>[0], conversationId: string, maxRounds = 30): Promise<number[]> {
  const consumed: number[] = [];
  while (true) {
    const pendingSnails = Array.from(new Set(deps.store.listPendingDispatches(conversationId).map((dispatch) => dispatch.to_snail)));
    if (pendingSnails.length === 0) return consumed;
    const results = await Promise.all(pendingSnails.map((snailName) => consumeSnailInbox(deps, conversationId, snailName, maxRounds)));
    consumed.push(...results.flatMap((result) => result.messageIds));
  }
}

function buildSnail(name: SnailName): SnailDefinition {
  return {
    name,
    description: `${name} test snail`,
    runtime: "opencode-cli",
    kind: name === "Boss Snail" ? "human" : "agent",
    capability_expectations: [],
    working_rules: [],
    preferred_artifact_types: [],
    system_prompt: { asset_id: "test" },
  };
}
