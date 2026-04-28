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
  await testStreamedReplyCanCompleteWithEmptyFinalContent();
  await testRuntimeFailureDoesNotConsumeDispatch();

  console.log("collaboration tests passed");
}

async function testStreamedReplyCanCompleteWithEmptyFinalContent(): Promise<void> {
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
        return { content: "" };
      },
    }),
    updateConversationRuntimeSessionId: () => undefined,
  }, conversation.id, [buildPlainTextEvent("请处理这个问题")], 1);

  assert(result.reply === "流式回复来自 Owner Snail", "sendStructuredMessage should return streamed reply content when final reply is empty");
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
          return { content: "" };
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
