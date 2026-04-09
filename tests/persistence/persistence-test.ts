import fs from "fs";
import path from "path";
import { ConversationStore } from "../../src/persistence/store";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-store.db");

if (fs.existsSync(TEST_DB)) {
  fs.unlinkSync(TEST_DB);
}

const store = new ConversationStore(TEST_DB);

const project = store.createProject("project-1", "system_self", "Snail Shell", "Self evolution");
console.log("Project:", project);

const stage = store.createStage("stage-1", project.id, "init", 1, "in_progress", [], new Date().toISOString());
console.log("Stage:", stage);

const conversation = store.createConversation(
  "conversation-1",
  project.id,
  stage.id,
  "Founding discussion",
  "discussion",
  "owner",
  ["owner", "product_agent"],
  "Initial discussion",
  []
);
console.log("Conversation:", conversation);

const userMessage = store.addMessage(conversation.id, "user");
store.replaceMessageParts(userMessage.id, [{ part_type: "text", content: "你好，Snail Shell" }]);

const assistantMessage = store.addMessage(conversation.id, "assistant");
store.replaceMessageParts(assistantMessage.id, [{ part_type: "text", content: "你好，我会记录这次演进。" }]);

const messages = store.getMessages(conversation.id);
console.log("Messages:", messages.length);
console.assert(messages.length === 2, "should have 2 messages");

const artifact = store.createArtifact(
  "artifact-1",
  project.id,
  stage.id,
  conversation.id,
  "project_charter",
  "Project Charter",
  "active",
  "inline_text",
  { inlineContent: "Snail Shell is a software production studio." }
);
console.log("Artifact:", artifact);

store.updateStage(stage.id, { formal_artifacts: [artifact.id] });
const updatedStage = store.getStage(stage.id)!;
console.assert(updatedStage.formal_artifacts[0] === artifact.id, "formal artifact should be saved");

store.close();
fs.unlinkSync(TEST_DB);

console.log("All store tests passed!");
