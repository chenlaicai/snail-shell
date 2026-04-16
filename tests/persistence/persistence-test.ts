import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-store.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });

if (fs.existsSync(TEST_DB)) {
  fs.unlinkSync(TEST_DB);
}

const store = new ConversationStore(TEST_DB);

const project = store.createProject("project-1", "system_self", "Snail Shell", "Self evolution");

const stage = store.createStage({
  id: "stage-1",
  projectId: project.id,
  type: "init",
  sequence: 1,
  status: "in_progress",
  formalArtifacts: [],
  enteredAt: new Date().toISOString(),
});

const conversation = store.createConversation({
  id: "conversation-1",
  projectId: project.id,
  stageId: stage.id,
  title: "Founding discussion",
  kind: "discussion",
  defaultSnail: "Owner Snail",
  participatingSnails: ["Boss Snail", "Owner Snail", "Product Snail"],
  summary: "Initial discussion",
  fromConversationIds: [],
});
console.assert(conversation.default_snail === "Owner Snail", "default snail should be saved");

const userMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Boss Snail", role: "user" });
store.replaceMessageParts(userMessage.id, [{ part_type: "text", text_value: "你好，Snail Shell" }]);

const assistantMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Owner Snail", role: "assistant" });
store.replaceMessageParts(assistantMessage.id, [{ part_type: "text", text_value: "你好，我会记录这次演进。" }]);

const messages = store.getMessages(conversation.id);
console.assert(messages.length === 2, "should have 2 messages");
console.assert(messages[1].producer_snail === "Owner Snail", "assistant speaker should be saved");

const searchResults = store.searchConversationMessages(conversation.id, "Snail Shell", 5, 0);
console.assert(searchResults.length >= 1, "fts search should return matching messages");
console.assert(searchResults[0].snippet.includes("Snail") || searchResults[0].snippet.includes("Shell"), "fts snippet should contain matched content");

const secondUserMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Boss Snail", role: "user" });
store.replaceMessageParts(secondUserMessage.id, [{ part_type: "text", text_value: "第二轮用户消息" }]);
const secondAssistantMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Owner Snail", role: "assistant" });
store.replaceMessageParts(secondAssistantMessage.id, [{ part_type: "result", text_value: "第二轮助手回复" }]);

const thirdUserMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Boss Snail", role: "user" });
store.replaceMessageParts(thirdUserMessage.id, [{ part_type: "text", text_value: "第三轮用户消息" }]);
const thirdAssistantMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Owner Snail", role: "assistant" });
store.replaceMessageParts(thirdAssistantMessage.id, [{ part_type: "result", text_value: "第三轮助手回复" }]);

const recentTurns = store.getRecentConversationTurns(conversation.id, 2);
console.assert(recentTurns[0].id === secondUserMessage.id, "recent conversation turns should start from the second latest user turn");
console.assert(recentTurns[recentTurns.length - 1].id === thirdAssistantMessage.id, "recent conversation turns should include following assistant messages");

const rebuildResult = store.rebuildSearchIndex(conversation.id);
console.assert(rebuildResult.indexed_messages === 6, "rebuild search index should cover all searchable messages");

const artifact = store.createArtifact({
  id: "artifact-1",
  projectId: project.id,
  stageId: stage.id,
  conversationId: conversation.id,
  artifactType: "project_charter",
  title: "Project Charter",
  status: "active",
  storageType: "inline_text",
  options: { inlineContent: "Snail Shell is a software production studio." },
});

store.updateStage(stage.id, { formal_artifacts: [artifact.id] });
const updatedStage = store.getStage(stage.id)!;
console.assert(updatedStage.formal_artifacts[0] === artifact.id, "formal artifact should be saved");

// Test Boss Snail pending dispatch count
const mentionMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Owner Snail", role: "assistant" });
store.replaceMessageParts(mentionMessage.id, [
  { part_type: "text", text_value: "请 " },
  { part_type: "mention", text_value: "@Boss Snail", ref_value: "Boss Snail" },
  { part_type: "text", text_value: " 确认一下这个方案" },
]);
store.addMessageDispatch({ conversationId: conversation.id, messageId: mentionMessage.id, targetSnail: "Boss Snail" });

const bossPendingDispatches = store.listBossPendingDispatches(conversation.id);
console.assert(bossPendingDispatches.length === 1, "should have 1 pending Boss Snail dispatch");
console.assert(bossPendingDispatches[0].target_snail === "Boss Snail", "dispatch target should be Boss Snail");
console.assert(bossPendingDispatches[0].status === "pending", "dispatch status should be pending");

store.close();
fs.unlinkSync(TEST_DB);
