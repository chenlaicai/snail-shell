import fs from "fs";
import path from "path";
import { ConversationStore, type CreateMessageEventInput } from "../../src/persistence/store";
import { buildAgentMessages } from "../../src/project/agent-message";
import { buildDeterministicMessageContext, formatMessageContextForPrompt } from "../../src/project/message-context";
import { buildPlainTextEvent, buildTextEvent, renderMessageEventsForDisplay } from "../../src/project/message-events";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-store.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const store = new ConversationStore(TEST_DB);
const project = store.createProject("project-1", "system_self", "Snail Shell", "Self evolution");
const feature = store.createFeature({ id: "feature-1", projectId: project.id, title: "Feature", summary: "Self evolution" });
const stage = store.createStage({ id: "stage-1", projectId: project.id, featureId: feature.id, type: "development", sequence: 1, status: "in_progress", formalArtifacts: [], enteredAt: new Date().toISOString() });
const conversation = store.createConversation({ id: "conversation-1", projectId: project.id, featureId: feature.id, stageId: stage.id, title: "Founding discussion", kind: "discussion", defaultSnail: "Owner Snail", participatingSnails: ["Boss Snail", "Owner Snail", "Product Snail"], summary: "Initial discussion", fromConversationIds: [] });

function persistCompletedMessage(input: { fromSnail: "Boss Snail" | "Owner Snail" | null; toSnails: Array<"Owner Snail" | "Boss Snail">; role: "user" | "assistant" | "system"; events: CreateMessageEventInput[] }) {
  const message = store.addMessage({ conversationId: conversation.id, fromSnail: input.fromSnail, toSnails: input.toSnails, role: input.role, runtime: "system", status: "streaming" });
  store.addMessageEvent(message.id, { kind: "start", payload: { role: input.role, snail_name: input.fromSnail, runtime: "system" }, source: { runtime_name: "system" } });
  input.events.forEach((event) => store.addMessageEvent(message.id, event));
  store.completeMessageWithEvent(message.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  const completed = store.getMessage(message.id)!;
  const context = buildDeterministicMessageContext(completed, store.getMessageEvents(message.id));
  store.upsertMessageContext(message.id, context.kind, context.context);
  store.rebuildDispatchesForMessage(message.id);
  return store.getMessagesByIds(conversation.id, [message.id])[0];
}

const userMessage = persistCompletedMessage({ fromSnail: "Boss Snail", toSnails: ["Owner Snail"], role: "user", events: [buildPlainTextEvent("你好，Snail Shell")] });
const userDispatches = store.listPendingDispatches(conversation.id, "Owner Snail");
assert(userDispatches.some((dispatch) => dispatch.message_id === userMessage.id), "addMessage should create pending dispatches for toSnails");
const assistantMessage = persistCompletedMessage({
  fromSnail: "Owner Snail",
  toSnails: [],
  role: "assistant",
  events: [
    buildPlainTextEvent("你好，我会记录这次演进。"),
    { kind: "error", payload: { source: "runtime", message: "recoverable-runtime-error", detail: null }, source: { runtime_name: "system" } },
  ],
});
assert(assistantMessage.context?.kind === "final_text", "assistant message context should prefer final text over error events");
assert(assistantMessage.context?.context === "你好，我会记录这次演进。", "assistant message context should store the final text only");
const systemMessage = persistCompletedMessage({ fromSnail: null, toSnails: [], role: "system", events: [buildPlainTextEvent("系统通知：进入下一阶段。")] });

const recentMessages = store.getRecentMessages(conversation.id, 3);
assert(recentMessages.some((message) => message.id === assistantMessage.id && message.context?.context === "你好，我会记录这次演进。"), "recent messages used by summary input should include persisted message context");
const messagesSinceProductReply = store.getMessagesSinceSnailReply(conversation.id, "Product Snail");
assert(formatMessageContextForPrompt(messagesSinceProductReply.find((message) => message.id === userMessage.id)!).includes("你好，Snail Shell"), "inbox messages used by agent prompts should include persisted message context");
const messageWindow = store.getMessageWindow(conversation.id, assistantMessage.id, 1, 1);
assert(messageWindow.some((message) => message.id === assistantMessage.id && message.context?.context === "你好，我会记录这次演进。"), "history message window should include persisted message context");

const messages = store.getMessages(conversation.id);
assert(messages.length === 3, "should have 3 messages");
assert(messages[0].events[0].kind === "start", "user message should start with start event");
assert(messages[0].events.some((event) => event.kind === "text"), "user message should persist text event");
assert(messages[0].status === "completed", "user message should be completed");
assert(messages[1].from_snail === "Owner Snail", "assistant speaker should be saved");
assert(messages[1].events.some((event) => event.kind === "error"), "assistant error event should be saved");
assert(messages[2].role === "system", "system message should be saved");
assert(renderMessageEventsForDisplay(systemMessage).includes("系统通知：进入下一阶段。"), "system display text should be derived from events");

const clientAckMessage = store.addMessage({ conversationId: conversation.id, clientId: "temp-user-persisted", fromSnail: "Boss Snail", toSnails: [], role: "user", runtime: "system", status: "streaming" });
assert(store.getMessage(clientAckMessage.id)?.client_id === "temp-user-persisted", "message should persist client_id for optimistic reconciliation");
store.addMessageEvent(clientAckMessage.id, { kind: "start", payload: { role: "user", snail_name: "Boss Snail", runtime: "system" }, source: { runtime_name: "system" } });
const cursorBeforeClientAckContent = store.getLastMessageEventId(conversation.id);
const clientAckContent = store.addMessageEvent(clientAckMessage.id, buildPlainTextEvent("cursor content"));
assert(clientAckContent.kind === "text" && clientAckContent.seq === 2, "addMessageEvent should return the event that was just inserted even after search reindexing");
assert(store.getMessageEventsAfter(conversation.id, cursorBeforeClientAckContent).some((event) => event.id === clientAckContent.id), "event cursor should recover message events appended after a loaded snapshot");
const activeSnapshot = store.getRecentMessagesSnapshot(conversation.id, 1);
assert(activeSnapshot.items.some((message) => message.id === clientAckMessage.id), "recent messages should include active streaming messages outside the fixed recent window");
const snapshotBeforeRace = store.getRecentMessagesSnapshot(conversation.id, 1, () => {
  store.addMessageEvent(clientAckMessage.id, buildPlainTextEvent("after snapshot cursor"));
});
assert(!snapshotBeforeRace.items.some((message) => message.events.some((event) => event.kind === "text" && event.payload.text === "after snapshot cursor")), "snapshot should not include events appended after its cursor boundary");
assert(store.getMessageEventsAfter(conversation.id, snapshotBeforeRace.last_event_id).some((event) => event.kind === "text" && event.payload.text === "after snapshot cursor"), "events appended after snapshot cursor should remain recoverable by backfill");

const searchResults = store.searchConversationMessages(conversation.id, "Snail Shell", 5, 0);
assert(searchResults.length >= 1, "fts search should return matching messages");
const errorSearchResults = store.searchConversationMessages(conversation.id, "recoverable-runtime-error", 5, 0);
assert(errorSearchResults.length === 0, "search should use effective message context instead of raw error events when final text exists");

const eventSummaryMessage = persistCompletedMessage({
  fromSnail: "Owner Snail",
  toSnails: [],
  role: "assistant",
  events: [
    { kind: "tool_call", payload: { tool_name: "Read", call_id: "tool-1", input: { filePath: "src/index.ts" }, title: null }, source: { runtime_name: "system" } },
    { kind: "tool_result", payload: { tool_name: "Read", call_id: "tool-1", is_error: true, output_text: null, error_text: "missing file", metadata: null }, source: { runtime_name: "system" } },
  ],
});
assert(eventSummaryMessage.context?.kind === "event_summary", "message without final text should summarize event stream");
assert(eventSummaryMessage.context?.context.includes("missing file"), "event summary should include key error detail");

const invalidMessage = store.addMessage({ conversationId: conversation.id, fromSnail: "Boss Snail", toSnails: [], role: "user", runtime: "system", status: "streaming" });
let rejectedMissingStart = false;
try {
  store.addMessageEvent(invalidMessage.id, buildPlainTextEvent("missing start"));
} catch {
  rejectedMissingStart = true;
}
assert(rejectedMissingStart, "first event must be start");

let rejectedCompleteBeforeStart = false;
try {
  store.completeMessageWithEvent(invalidMessage.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null } }, "completed");
} catch {
  rejectedCompleteBeforeStart = true;
}
assert(rejectedCompleteBeforeStart, "message cannot complete before start event");

let rejectedTerminalAppend = false;
try {
  store.addMessageEvent(userMessage.id, { kind: "start", payload: { role: "user", snail_name: "Boss Snail", runtime: "system" } });
} catch {
  rejectedTerminalAppend = true;
}
assert(rejectedTerminalAppend, "terminal messages must reject all new events");

const secondUserMessage = persistCompletedMessage({ fromSnail: "Boss Snail", toSnails: ["Owner Snail"], role: "user", events: [buildPlainTextEvent("第二轮用户消息")] });
const secondAssistantMessage = persistCompletedMessage({ fromSnail: "Owner Snail", toSnails: [], role: "assistant", events: [buildPlainTextEvent("第二轮助手回复")] });
const thirdUserMessage = persistCompletedMessage({ fromSnail: "Boss Snail", toSnails: ["Owner Snail"], role: "user", events: [buildPlainTextEvent("第三轮用户消息")] });
const thirdAssistantMessage = persistCompletedMessage({ fromSnail: "Owner Snail", toSnails: [], role: "assistant", events: [buildPlainTextEvent("第三轮助手回复")] });
void secondAssistantMessage;
void thirdUserMessage;
const recentMessagesWindow = store.getRecentConversationMessagesWindow(conversation.id, 2);
assert(recentMessagesWindow[0].id === secondUserMessage.id, "recent conversation message window should start from the second latest user message");
assert(recentMessagesWindow[recentMessagesWindow.length - 1].id === thirdAssistantMessage.id, "recent conversation message window should include following assistant messages");

const rebuildResult = store.rebuildSearchIndex(conversation.id);
assert(rebuildResult.indexed_messages >= 1, "rebuild search index should report indexed messages");

const agentMessages = buildAgentMessages(conversation, [userMessage, assistantMessage]);
const assistantContextMessage = agentMessages.find((message) => message.role === "assistant" && message.content.includes("Owner Snail:"));
assert(assistantContextMessage?.content.includes("你好，我会记录这次演进。"), "assistant context should include text events");
assert(!assistantContextMessage?.content.includes("recoverable-runtime-error"), "assistant context should not include raw error events when final text exists");

const artifact = store.createArtifact({ id: "artifact-1", projectId: project.id, featureId: feature.id, stageId: stage.id, conversationId: conversation.id, artifactType: "project_charter", title: "Project Charter", status: "active", storageType: "inline_text", options: { inlineContent: "Snail Shell is a software production studio." } });
store.updateStage(stage.id, { formal_artifacts: [artifact.id] });
assert(store.getStage(stage.id)!.formal_artifacts[0] === artifact.id, "formal artifact should be saved");

const candidateKnowledge = store.createKnowledge({
  id: "knowledge-1",
  projectId: project.id,
  scopeType: "project",
  scopeRef: project.id,
  kind: "decision",
  title: "知识必须人工审批",
  content: "候选知识不得自动反哺，必须经过人工审批后才能进入 active 状态。approval-gate",
  rationale: "知识会影响后续 agent 行为，审批是治理边界。",
  createdBy: "Boss Snail",
  sources: [{ id: "knowledge-source-1", sourceType: "message", sourceId: String(userMessage.id), quote: "知识必须人工审批" }],
});
assert(candidateKnowledge.status === "candidate", "new knowledge should default to candidate status");
assert(candidateKnowledge.sources[0].source_id === String(userMessage.id), "knowledge should preserve source traceability");
assert(store.listKnowledge({ projectId: project.id, status: "candidate" }).some((item) => item.id === candidateKnowledge.id), "candidate knowledge should be listable by project and status");
assert(store.searchKnowledge({ query: "approval-gate", projectId: project.id }).some((item) => item.id === candidateKnowledge.id), "knowledge should be searchable by FTS");
const directActiveKnowledge = store.createKnowledge({ id: "knowledge-direct-active", projectId: project.id, scopeType: "project", scopeRef: project.id, kind: "rule", status: "active", title: "存储层允许迁移导入 active 知识", content: "只有受控调用方可以直接写入 active。" });
assert(directActiveKnowledge.status === "active", "store should keep direct active creation available for trusted migrations");
const approvedKnowledge = store.approveKnowledge(candidateKnowledge.id, { reviewer: "Boss Snail", updates: { governance_level: "L2" } });
assert(approvedKnowledge.status === "active", "approved knowledge should become active");
store.upsertKnowledgeUsagePolicy(approvedKnowledge.id, { allowPromptInjection: true, promptMode: "summary", priority: 30, stageTypes: [stage.type], snailNames: ["Owner Snail"] });
const blockedBySnailKnowledge = store.listPromptInjectableKnowledge({ projectId: project.id, featureId: feature.id, stageType: stage.type, snailName: "Product Snail", conversationId: conversation.id, stageId: stage.id });
assert(!blockedBySnailKnowledge.some((item) => item.id === approvedKnowledge.id), "usage policy should prevent prompt injection for non-matching snails");
const injectableKnowledge = store.listPromptInjectableKnowledge({ projectId: project.id, featureId: feature.id, stageType: stage.type, snailName: "Owner Snail", conversationId: conversation.id, stageId: stage.id });
assert(injectableKnowledge.some((item) => item.id === approvedKnowledge.id), "active knowledge with policy should be injectable in matching project scope");
const knowledgeUse = store.recordKnowledgeUse({ id: "knowledge-use-1", knowledgeId: approvedKnowledge.id, conversationId: conversation.id, stageId: stage.id, snailName: "Owner Snail", useType: "manual_reference" });
assert(knowledgeUse.use_type === "manual_reference", "knowledge use should record use type");
assert(store.listKnowledgeUses(approvedKnowledge.id).length === 2, "prompt injection and manual use history should be queryable");

const mentionMessage = persistCompletedMessage({ fromSnail: "Owner Snail", toSnails: ["Boss Snail"], role: "assistant", events: [buildTextEvent("请 @Boss Snail 确认一下这个方案", ["Boss Snail"])] });
assert(mentionMessage.events.some((event) => event.kind === "text" && event.payload.mentions.includes("Boss Snail")), "mentions should be stored on text events");
const bossPendingDispatches = store.listBossPendingDispatches(conversation.id);
assert(bossPendingDispatches.length === 1, "should have 1 pending Boss Snail dispatch");

store.close();
fs.unlinkSync(TEST_DB);
console.log("persistence tests passed");
