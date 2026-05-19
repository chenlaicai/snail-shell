import fs from "fs";
import path from "path";
import { ConversationStore, type Message } from "../../src/persistence/store";
import { recoverOrphanedStreamingAssistantMessages } from "../../src/project-workflow/startup-recovery";
import { buildPlainTextEvent } from "../../src/message-bus/message-events";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-startup-recovery.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

async function main(): Promise<void> {
  const store = new ConversationStore(TEST_DB);
  store.seedProjectConfig({
    project: { id: "startup-recovery-project", kind: "system_self", name: "Snail Shell", summary: "test" },
    stage_definitions: [
      { id: "startup-recovery-sd-dev", key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "交付", acceptance_focus: [], roles: [{ id: "startup-recovery-sr-impl", name: "研发者", snail_template_id: "opencode-default", is_primary: true, description: "", working_rules: [] }] },
    ],
  });
  const project = store.getProject("startup-recovery-project")!;
  const feature = store.createFeature({ id: "startup-recovery-feature", projectId: project.id, title: "Feature" });
  const stage = store.createStage({ id: "startup-recovery-stage", projectId: project.id, featureId: feature.id, stageDefinitionId: "startup-recovery-sd-dev", type: "development", sequence: 1, status: "in_progress", enteredAt: new Date().toISOString() });
  const conversation = store.createConversation({ id: "startup-recovery-conversation", projectId: project.id, featureId: feature.id, stageId: stage.id, title: "Conversation", kind: "discussion", defaultRole: "研发者", participatingRoles: ["Boss Role", "研发者"], fromConversationIds: [] });
  const knowledge = store.createKnowledge({ id: "startup-recovery-knowledge", projectId: project.id, scopeType: "project", scopeRef: project.id, kind: "rule", title: "启动恢复治理消息", content: "治理 conversation 的 streaming assistant 也需要恢复。" });
  const governanceConversationId = knowledge.governance?.conversation?.id;
  if (!governanceConversationId) throw new Error("knowledge governance conversation should exist");

  const completed = createCompletedAssistantMessage(store, conversation.id, "已经完成");
  const streaming = createStreamingAssistantMessage(store, conversation.id, "部分输出");
  const missingStart = store.addMessage({ conversationId: conversation.id, fromRole: "研发者", toRoles: [], role: "assistant", runtime: "opencode", status: "streaming" });
  const dirtyMissingStart = createDirtyMissingStartMessage(store, conversation.id);
  const governanceStreaming = createStreamingAssistantMessage(store, governanceConversationId, "治理会话里的部分输出", governanceConversationId);

  const result = await recoverOrphanedStreamingAssistantMessages({ store, summaryGenerator: null });
  assertRecoveryResult(result, [streaming, missingStart, dirtyMissingStart, governanceStreaming]);
  assertProjectRecovery(store, conversation.id, { streaming, missingStart, dirtyMissingStart });
  assertGovernanceRecovery(store, governanceConversationId, governanceStreaming);

  const secondRun = await recoverOrphanedStreamingAssistantMessages({ store, summaryGenerator: null });
  assert(secondRun.recovered_message_ids.length === 0, "startup recovery should be idempotent after all orphaned messages are terminal");
  assert(store.getMessage(completed.id)?.status === "completed", "completed messages must not be modified by startup recovery");

  store.close();
  fs.unlinkSync(TEST_DB);
  console.log("startup recovery tests passed");
}

function createCompletedAssistantMessage(store: ConversationStore, conversationId: string, text: string): Message {
  const completed = store.addMessage({ conversationId, fromRole: "研发者", toRoles: [], role: "assistant", runtime: "system", status: "streaming" });
  store.addMessageEvent(completed.id, { kind: "start", payload: { role: "assistant", role_name: "研发者", runtime: "system" }, source: { runtime_name: "system" } }, conversationId);
  store.addMessageEvent(completed.id, buildPlainTextEvent(text), conversationId);
  store.completeMessageWithEvent(completed.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed", conversationId);
  return completed;
}

function createStreamingAssistantMessage(store: ConversationStore, conversationId: string, text: string, explicitConversationId?: string): Message {
  const message = store.addMessage({ conversationId, fromRole: "研发者", toRoles: [], role: "assistant", runtime: "opencode", status: "streaming" });
  const scopedConversationId = explicitConversationId ?? conversationId;
  store.addMessageEvent(message.id, { kind: "start", payload: { role: "assistant", role_name: "研发者", runtime: "opencode" }, source: { runtime_name: "opencode" } }, scopedConversationId);
  store.addMessageEvent(message.id, buildPlainTextEvent(text), scopedConversationId);
  return message;
}

function createDirtyMissingStartMessage(store: ConversationStore, conversationId: string): Message {
  const message = store.addMessage({ conversationId, fromRole: "研发者", toRoles: [], role: "assistant", runtime: "opencode", status: "streaming" });
  store.addMessageEvent(message.id, { kind: "start", payload: { role: "assistant", role_name: "研发者", runtime: "opencode" }, source: { runtime_name: "opencode" } }, conversationId);
  store.updateMessageStatus(message.id, "streaming");
  const dirtyStartEvent = store.getMessageEvents(message.id, conversationId)[0];
  (store as any).db.prepare("UPDATE message_event SET kind = ?, category = ?, payload = ? WHERE id = ?").run("text", "content", JSON.stringify({ text: "缺失 start 但已有内容" }), dirtyStartEvent.id);
  return message;
}

function assertRecoveryResult(result: Awaited<ReturnType<typeof recoverOrphanedStreamingAssistantMessages>>, expectedMessages: Message[]): void {
  assert(result.recovered_message_ids.length === expectedMessages.length, "startup recovery should recover project and governance streaming assistant messages");
  assert(result.failed_message_ids.length === 0, "startup recovery should not fail recoverable dirty orphaned messages");
  for (const message of expectedMessages) {
    assert(result.recovered_message_ids.includes(message.id), "startup recovery should include every orphaned message even when ids are conversation-local");
  }
}

function assertProjectRecovery(store: ConversationStore, conversationId: string, messages: { streaming: Message; missingStart: Message; dirtyMissingStart: Message }): void {
  const recovered = store.getMessagesByIds(conversationId, [messages.streaming.id, messages.missingStart.id, messages.dirtyMissingStart.id]);
  const recoveredStreaming = recovered.find((message) => message.id === messages.streaming.id);
  const recoveredMissingStart = recovered.find((message) => message.id === messages.missingStart.id);
  const recoveredDirtyMissingStart = recovered.find((message) => message.id === messages.dirtyMissingStart.id);
  assert(recoveredStreaming?.status === "interrupted", "streaming assistant should become interrupted");
  assert(recoveredStreaming?.events.some((event) => event.kind === "signal" && event.payload.type === "message_interrupted"), "recovered message should include interrupted terminal signal");
  assert(recoveredStreaming?.context?.context === "部分输出", "recovered message should preserve partial final text as context");
  assert(recoveredMissingStart?.status === "interrupted", "missing-start orphan should also become interrupted");
  assert(recoveredMissingStart?.events[0]?.kind === "start", "missing-start orphan should receive a synthetic start event before terminal signal");
  assert(recoveredMissingStart?.context?.context.includes("server_startup_orphaned_streaming_message"), "event-summary context should explain startup recovery reason");
  assert(recoveredDirtyMissingStart?.status === "interrupted", "dirty missing-start orphan should also become interrupted");
  assert(recoveredDirtyMissingStart?.events[0]?.kind === "text", "dirty missing-start orphan should keep its original event order");
  assert(recoveredDirtyMissingStart?.events.some((event) => event.kind === "signal" && event.payload.type === "message_interrupted"), "dirty missing-start orphan should receive terminal signal");
  assert(recoveredDirtyMissingStart?.context?.context === "缺失 start 但已有内容", "dirty missing-start orphan should preserve existing text context");
}

function assertGovernanceRecovery(store: ConversationStore, conversationId: string, message: Message): void {
  const recoveredGovernanceStreaming = store.getMessage(message.id, conversationId);
  assert(recoveredGovernanceStreaming?.status === "interrupted", "governance streaming assistant should become interrupted during startup recovery");
  assert(store.getMessageContext(message.id, conversationId)?.context === "治理会话里的部分输出", "governance startup recovery should persist context in the governance table");
}

main().catch((error) => {
  throw error;
});
