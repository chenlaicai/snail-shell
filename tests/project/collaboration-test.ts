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
};

main().catch((error) => {
  throw error;
});

async function main(): Promise<void> {
  await testStreamedEventsCompleteWithoutReturnText();
  await testStreamedJsonStillRoutesStructuredMentions();
  await testToolResultMessageOutDoesNotRouteAsMessageContent();
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

function createContext(suffix: string): { store: ConversationStore; conversation: ReturnType<ConversationStore["createConversation"]> } {
  const dbPath = path.join(TEST_DATA_DIR, `test-collaboration-${suffix}.db`);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const store = new ConversationStore(dbPath);
  const project = store.createProject(`project-collaboration-${suffix}`, "system_self", "Snail Shell", "Collaboration test");
  const stage = store.createStage({ id: `stage-collaboration-${suffix}`, projectId: project.id, type: "development", sequence: 1, status: "in_progress", formalArtifacts: [], enteredAt: new Date().toISOString() });
  const conversation = store.createConversation({ id: `conversation-collaboration-${suffix}`, projectId: project.id, stageId: stage.id, title: "Collaboration", kind: "discussion", defaultSnail: "Owner Snail", participatingSnails: ["Boss Snail", "Owner Snail", "Product Snail"], fromConversationIds: [] });
  return { store, conversation };
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
