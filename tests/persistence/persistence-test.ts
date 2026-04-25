import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";
import { buildPlainTextResultPart, buildResultPart } from "../../src/project/message-parts";
import { buildAgentMessages } from "../../src/project/agent-message";

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

const userMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: "Boss Snail",
  toSnails: ["Owner Snail"],
  role: "user",
});
store.setMessageContent(userMessage.id, buildPlainTextResultPart("你好，Snail Shell"));
store.rebuildDispatchesForMessage(userMessage.id);

const assistantMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: "Owner Snail",
  toSnails: [],
  role: "assistant",
});
store.setMessageContent(assistantMessage.id, buildPlainTextResultPart("你好，我会记录这次演进。"));
store.addMessagePart(assistantMessage.id, { kind: "delta", payload: { kind: "error_observation", source: "runtime", error_text: "执行时遇到可恢复错误" } });

const systemMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: null,
  toSnails: [],
  role: "system",
});
store.setMessageContent(systemMessage.id, buildPlainTextResultPart("系统通知：进入下一阶段。"));

const messages = store.getMessages(conversation.id);
console.assert(messages.length === 3, "should have 3 messages");
console.assert(messages[0].parts.some((part) => part.kind === "result"), "user message should have a result part");
console.assert(!messages[0].parts.some((part) => part.kind === "start"), "raw store writes should not fabricate start parts automatically");
console.assert(messages[1].from_snail === "Owner Snail", "assistant speaker should be saved");
console.assert(messages[1].parts.some((part) => part.kind === "delta" && part.payload.kind === "error_observation"), "assistant error part should be saved");
console.assert(messages[2].role === "system", "system message should be saved");
console.assert(messages[2].parts.some((part) => part.kind === "result" && (part.payload.format === "plain_text" || part.payload.format === "structured_text") && part.payload.content === "系统通知：进入下一阶段。"), "system message should use result part");

const searchResults = store.searchConversationMessages(conversation.id, "Snail Shell", 5, 0);
console.assert(searchResults.length >= 1, "fts search should return matching messages");
console.assert(searchResults[0].snippet.includes("Snail") || searchResults[0].snippet.includes("Shell"), "fts snippet should contain matched content");

const errorSearchResults = store.searchConversationMessages(conversation.id, "可恢复错误", 5, 0);
console.assert(errorSearchResults.length === 0, "assistant error deltas should not be indexed when a formal result exists");

const systemSearchResults = store.searchConversationMessages(conversation.id, "进入下一阶段", 5, 0);
console.assert(systemSearchResults.length >= 1, "fts search should index system content parts");

const secondUserMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: "Boss Snail",
  toSnails: ["Owner Snail"],
  role: "user",
});
store.setMessageContent(secondUserMessage.id, buildPlainTextResultPart("第二轮用户消息"));
const secondAssistantMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: "Owner Snail",
  toSnails: [],
  role: "assistant",
});
store.setMessageContent(secondAssistantMessage.id, buildPlainTextResultPart("第二轮助手回复"));

const thirdUserMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: "Boss Snail",
  toSnails: ["Owner Snail"],
  role: "user",
});
store.setMessageContent(thirdUserMessage.id, buildPlainTextResultPart("第三轮用户消息"));
const thirdAssistantMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: "Owner Snail",
  toSnails: [],
  role: "assistant",
});
store.setMessageContent(thirdAssistantMessage.id, buildPlainTextResultPart("第三轮助手回复"));

const recentMessagesWindow = store.getRecentConversationMessagesWindow(conversation.id, 2);
console.assert(recentMessagesWindow[0].id === secondUserMessage.id, "recent conversation message window should start from the second latest user message");
console.assert(recentMessagesWindow[recentMessagesWindow.length - 1].id === thirdAssistantMessage.id, "recent conversation message window should include following assistant messages");

const rebuildResult = store.rebuildSearchIndex(conversation.id);
console.assert(rebuildResult.indexed_messages >= 1, "rebuild search index should report indexed messages");

const agentMessages = buildAgentMessages(conversation, messages);
const assistantContextMessage = agentMessages.find((message) => message.role === "assistant" && message.content.includes("Owner Snail:"));
console.assert(assistantContextMessage?.content.includes("你好，我会记录这次演进。"), "assistant context should include formal result text");
console.assert(!assistantContextMessage?.content.includes("执行时遇到可恢复错误"), "assistant context should not append delta error text when result exists");

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

const mentionMessage = store.addMessage({
  conversationId: conversation.id,
  fromSnail: "Owner Snail",
  toSnails: ["Boss Snail"],
  role: "assistant",
});
store.setMessageContent(mentionMessage.id, buildResultPart("请 @Boss Snail 确认一下这个方案", ["Boss Snail"]));
store.rebuildDispatchesForMessage(mentionMessage.id);

const bossPendingDispatches = store.listBossPendingDispatches(conversation.id);
console.assert(bossPendingDispatches.length === 1, "should have 1 pending Boss Snail dispatch");
console.assert(bossPendingDispatches[0].to_snail === "Boss Snail", "dispatch target should be Boss Snail");
console.assert(bossPendingDispatches[0].status === "pending", "dispatch status should be pending");

store.close();
fs.unlinkSync(TEST_DB);
