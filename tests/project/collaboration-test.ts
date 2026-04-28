import fs from "fs";
import path from "path";
import type { AgentEvent, SnailRuntimeMessageInput } from "../../src/agent/interface";
import { ConversationStore, type CreateMessageEventInput, type SnailName } from "../../src/persistence/store";
import { sendStructuredMessage, structuredMentionsFromEvents, type MentionResolution } from "../../src/project/collaboration";
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
  await testRuntimeFailureDoesNotConsumeDispatch();

  console.log("collaboration tests passed");
}

async function testStreamedEventsCompleteWithoutReturnText(): Promise<void> {
  const { store, conversation } = createContext("success");
  const result = await sendStructuredMessage({
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
  }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);

  const messages = store.getMessages(conversation.id);
  assert(result.messageIds.length === 2, "sendStructuredMessage should return created message ids");
  assert(messages.some((message) => message.id === result.messageIds[1] && message.events.some((event) => event.kind === "text")), "agent text should be persisted as message events");
  store.close();
}

async function testRuntimeFailureDoesNotConsumeDispatch(): Promise<void> {
  const { store, conversation } = createContext("runtime-failure");
  let failed = false;

  try {
    await sendStructuredMessage({
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
        invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          onEvent({ type: "message_event", event: buildPlainTextEvent("准备执行") });
          onEvent({ type: "message_failure", error: "Claude Code denied required tool approval (ExitPlanMode). The agent did not continue execution." });
          return {};
        },
      }),
      updateConversationRuntimeSessionId: () => undefined,
    }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);
  } catch (error) {
    failed = true;
    assert(error instanceof Error && error.message.includes("ExitPlanMode"), "runtime failure should propagate to the caller");
  }

  const dispatches = store.listDispatches(conversation.id);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  assert(failed, "sendStructuredMessage should fail when runtime reports terminal failure");
  assert(dispatches.length === 1 && dispatches[0]?.status === "pending", "runtime failure must leave the dispatch pending for retry or manual handling");
  assert(assistantMessages.length === 1 && assistantMessages[0]?.status === "failed", "failed runtime reply should be persisted as a failed message");
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
  };

  await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 3);

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
  };

  const result = await sendStructuredMessage(deps, conversation.id, [buildPlainTextEvent("请处理这个问题")], 3);
  const assistantMessages = store.getMessages(conversation.id).filter((message) => message.role === "assistant");
  const assistantEvents = assistantMessages.flatMap((message) => message.events);

  assert(calls.length === 1 && calls[0] === "Owner Snail", "message-out inside tool_result must not route mentions as message content");
  assert(result.messageIds.length === 2, "tool_result-only output should still return created message ids");
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
      invokeMessage: async () => ({ content: JSON.stringify({ format: "blocks", fallback_text: `${snail.name} done`, blocks: [{ type: "text", text: `${snail.name} done`, mentions: [] }] }) }),
    }),
    updateConversationRuntimeSessionId: () => undefined,
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
  assert(started.every((snailName) => snailName === "Owner Snail"), "forced wrap-up dispatches should run as the default snail");
  store.close();
}

function createContext(suffix: string): { store: ConversationStore; conversation: ReturnType<ConversationStore["createConversation"]> } {
  const dbPath = path.join(TEST_DATA_DIR, `test-collaboration-${suffix}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const store = new ConversationStore(dbPath);
  const project = store.createProject(`project-collaboration-${suffix}`, "system_self", "Snail Shell", "Collaboration test");
  const stage = store.createStage({ id: `stage-collaboration-${suffix}`, projectId: project.id, type: "development", sequence: 1, status: "in_progress", formalArtifacts: [], enteredAt: new Date().toISOString() });
  const conversation = store.createConversation({ id: `conversation-collaboration-${suffix}`, projectId: project.id, stageId: stage.id, title: "Collaboration", kind: "discussion", defaultSnail: "Owner Snail", participatingSnails: ["Boss Snail", "Owner Snail", "Product Snail", "Design Snail"], fromConversationIds: [] });
  return { store, conversation };
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
