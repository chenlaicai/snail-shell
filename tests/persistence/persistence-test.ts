import fs from "fs";
import path from "path";
import { ConversationStore, PartType } from "../../src/persistence/store";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-store.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });

if (fs.existsSync(TEST_DB)) {
  fs.unlinkSync(TEST_DB);
}

const store = new ConversationStore(TEST_DB);

const project = store.createProject({
  id: "project-1",
  kind: "system_self",
  name: "Snail Shell",
  workflowStageTypes: ["init", "discuss", "coding", "check", "publish"],
  workflowStageDefinitions: {
    init: {
      order: 1,
      title: "项目初始化",
      formal_artifact_types: ["project_charter", "initiative_discussion_record"],
      snails: ["Owner Snail", "Product Snail"],
      input: [],
      output: {
        summary: "明确项目基础边界，并完成项目初始化类正式产物。",
        required_artifacts: ["project_charter", "initiative_discussion_record"],
        artifact_requirements: ["项目目标需要明确"],
      },
      acceptance_focus: ["项目是否已经被清晰定义"],
    },
    discuss: {
      order: 2,
      title: "需求讨论",
      formal_artifact_types: ["requirement_document"],
      snails: ["Product Snail", "Owner Snail"],
      input: ["project_charter", "initiative_discussion_record"],
      output: {
        summary: "沉淀需求讨论结果。",
        required_artifacts: ["requirement_document"],
        artifact_requirements: ["需求需要结构化表达"],
      },
      acceptance_focus: ["需求是否完整且清晰"],
    },
    coding: {
      order: 3,
      title: "代码",
      formal_artifact_types: ["code_change_record"],
      snails: ["Implementation Snail", "Design Snail"],
      input: ["requirement_document"],
      output: {
        summary: "完成代码实现。",
        required_artifacts: ["code_change_record"],
        artifact_requirements: ["代码实现必须可追溯"],
      },
      acceptance_focus: ["代码质量是否达标"],
    },
    check: {
      order: 4,
      title: "验收",
      formal_artifact_types: ["acceptance_report"],
      snails: ["Acceptance Snail", "Owner Snail"],
      input: ["code_change_record"],
      output: {
        summary: "对当前交付进行验收。",
        required_artifacts: ["acceptance_report"],
        artifact_requirements: ["必须明确通过或不通过结论"],
      },
      acceptance_focus: ["交付结果是否符合预期"],
    },
    publish: {
      order: 5,
      title: "正式推出",
      formal_artifact_types: ["evolution_record"],
      snails: ["Owner Snail", "Acceptance Snail"],
      input: ["acceptance_report"],
      output: {
        summary: "形成正式推出结论。",
        required_artifacts: ["evolution_record"],
        artifact_requirements: ["必须明确推出结论"],
      },
      acceptance_focus: ["推出结论是否明确"],
    },
  },
  artifactDefinitions: {
    project_charter: { title: "Project Charter", description: "Project charter", storage_type: "inline_text", formal: true },
    initiative_discussion_record: { title: "Initiative Discussion Record", description: "Discussion record", storage_type: "inline_text", formal: true },
    requirement_document: { title: "Requirement Document", description: "Requirement doc", storage_type: "inline_text", formal: true },
    code_change_record: { title: "Code Change Record", description: "Code change", storage_type: "inline_text", formal: true },
    acceptance_report: { title: "Acceptance Report", description: "Acceptance", storage_type: "inline_text", formal: true },
    evolution_record: { title: "Evolution Record", description: "Evolution", storage_type: "inline_text", formal: true },
  },
  snailDefinitions: {
    "Owner Snail": {
      name: "Owner Snail",
      description: "Owner",
      runtime: "claude-code-cli",
      kind: "agent",
      capability_expectations: [],
      working_rules: [],
      preferred_artifact_types: ["project_charter"],
      system_prompt: { identity: "Owner", principles: [], output_expectations: [] },
    },
    "Product Snail": {
      name: "Product Snail",
      description: "Product",
      runtime: "claude-code-cli",
      kind: "agent",
      capability_expectations: [],
      working_rules: [],
      preferred_artifact_types: ["requirement_document"],
      system_prompt: { identity: "Product", principles: [], output_expectations: [] },
    },
    "Implementation Snail": {
      name: "Implementation Snail",
      description: "Implementation",
      runtime: "claude-code-cli",
      kind: "agent",
      capability_expectations: [],
      working_rules: [],
      preferred_artifact_types: ["code_change_record"],
      system_prompt: { identity: "Implementation", principles: [], output_expectations: [] },
    },
    "Design Snail": {
      name: "Design Snail",
      description: "Design",
      runtime: "claude-code-cli",
      kind: "agent",
      capability_expectations: [],
      working_rules: [],
      preferred_artifact_types: ["requirement_document"],
      system_prompt: { identity: "Design", principles: [], output_expectations: [] },
    },
    "Acceptance Snail": {
      name: "Acceptance Snail",
      description: "Acceptance",
      runtime: "opencode-cli",
      kind: "agent",
      capability_expectations: [],
      working_rules: [],
      preferred_artifact_types: ["acceptance_report"],
      system_prompt: { identity: "Acceptance", principles: [], output_expectations: [] },
    },
    "Boss Snail": {
      name: "Boss Snail",
      description: "Boss",
      runtime: "claude-code-cli",
      kind: "human",
      capability_expectations: [],
      working_rules: [],
      preferred_artifact_types: [],
      system_prompt: { identity: "Boss", principles: [], output_expectations: [] },
    },
  },
  summary: "Self evolution",
});

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
store.replaceMessageParts(userMessage.id, [{ part_type: PartType.CONTENT, text_value: "你好，Snail Shell" }]);

const assistantMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Owner Snail", role: "assistant" });
store.replaceMessageParts(assistantMessage.id, [{ part_type: PartType.CONTENT, text_value: "你好，我会记录这次演进。" }]);

const messages = store.getMessages(conversation.id);
console.assert(messages.length === 2, "should have 2 messages");
console.assert(messages[1].producer_snail === "Owner Snail", "assistant speaker should be saved");

const searchResults = store.searchConversationMessages(conversation.id, "Snail Shell", 5, 0);
console.assert(searchResults.length >= 1, "fts search should return matching messages");
console.assert(searchResults[0].snippet.includes("Snail") || searchResults[0].snippet.includes("Shell"), "fts snippet should contain matched content");

const secondUserMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Boss Snail", role: "user" });
store.replaceMessageParts(secondUserMessage.id, [{ part_type: PartType.CONTENT, text_value: "第二轮用户消息" }]);
const secondAssistantMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Owner Snail", role: "assistant" });
store.replaceMessageParts(secondAssistantMessage.id, [{ part_type: PartType.CONTENT, text_value: "第二轮助手回复" }]);

const thirdUserMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Boss Snail", role: "user" });
store.replaceMessageParts(thirdUserMessage.id, [{ part_type: PartType.CONTENT, text_value: "第三轮用户消息" }]);
const thirdAssistantMessage = store.addMessage({ conversationId: conversation.id, producerSnail: "Owner Snail", role: "assistant" });
store.replaceMessageParts(thirdAssistantMessage.id, [{ part_type: PartType.CONTENT, text_value: "第三轮助手回复" }]);

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
  { part_type: PartType.CONTENT, text_value: "请 @Boss Snail 确认一下这个方案", mentions: ["Boss Snail"] },
]);
store.addMessageDispatch({ conversationId: conversation.id, messageId: mentionMessage.id, targetSnail: "Boss Snail" });

const bossPendingDispatches = store.listBossPendingDispatches(conversation.id);
console.assert(bossPendingDispatches.length === 1, "should have 1 pending Boss Snail dispatch");
console.assert(bossPendingDispatches[0].target_snail === "Boss Snail", "dispatch target should be Boss Snail");
console.assert(bossPendingDispatches[0].status === "pending", "dispatch status should be pending");

store.close();
fs.unlinkSync(TEST_DB);
