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

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-collaboration.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const store = new ConversationStore(TEST_DB);
const project = store.createProject("project-collaboration", "system_self", "Snail Shell", "Collaboration test");
const stage = store.createStage({ id: "stage-collaboration", projectId: project.id, type: "development", sequence: 1, status: "in_progress", formalArtifacts: [], enteredAt: new Date().toISOString() });
const conversation = store.createConversation({ id: "conversation-collaboration", projectId: project.id, stageId: stage.id, title: "Collaboration", kind: "discussion", defaultSnail: "Owner Snail", participatingSnails: ["Boss Snail", "Owner Snail", "Product Snail"], fromConversationIds: [] });

const snails: Partial<Record<SnailName, SnailDefinition>> = {
  "Boss Snail": buildSnail("Boss Snail"),
  "Owner Snail": buildSnail("Owner Snail"),
  "Product Snail": buildSnail("Product Snail"),
};

main().catch((error) => {
  throw error;
});

async function main(): Promise<void> {
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

  console.log("collaboration tests passed");
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
