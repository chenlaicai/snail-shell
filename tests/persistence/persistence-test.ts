import fs from "fs";
import path from "path";
import { ConversationStore, type CreateMessageEventInput } from "../../src/persistence/store";
import { buildAgentMessages } from "../../src/message-bus/agent-message";
import { buildDeterministicMessageContext, formatMessageContextForPrompt } from "../../src/message-bus/message-context";
import { buildContentBlockEvent, buildPlainTextEvent, buildTextEvent, renderMessageEventsForDisplay } from "../../src/message-bus/message-events";
import { stringifyMessageOutPart } from "../../src/message-bus/message-out";
import { createStreamingContext, finalizeMessageLifecycle } from "../../src/message-bus/message-protocol";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-store.db");
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const store = new ConversationStore(TEST_DB);
store.seedProjectConfigs({
  sops: [{
    sop: { id: "sop-project-1", scope: "global", key: "project-1-sop", name: "Project 1 SOP" },
    role_definitions: [
      { id: "role-p1-developer", key: "developer", name: "研发者", description: "", working_rules: [] },
      { id: "role-p1-reviewer", key: "reviewer", name: "检视者", description: "", working_rules: [] },
    ],
    stage_definitions: [
      { id: "sd-development", key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "交付 PR", acceptance_focus: [], roles: [{ role_key: "developer", is_primary: true }] },
      { id: "sd-review", key: "review", title: "PR 检视", sequence: 2, input_description: "上一阶段产出", output_description: "检视完成", acceptance_focus: [], roles: [{ role_key: "reviewer", is_primary: true }] },
    ],
  }, {
    sop: { id: "sop-knowledge-center", scope: "global", key: "knowledge-center-sop", name: "Knowledge Center SOP" },
    role_definitions: [
      { id: "role-kc-boss", key: "boss", name: "Boss Role", description: "最终决策者，确认治理结论", working_rules: ["以数据为依据做决策", "治理结论需明确落地入口"] },
      { id: "role-kc-executor", key: "knowledge-executor", name: "知识执行者", description: "负责执行知识治理流程：入口校验、查重、裁决去向跟踪", working_rules: ["严格按入口校验流程", "查重需覆盖全局知识库", "裁决去向必须明确并记录PR链接"] },
    ],
    stage_definitions: [
      { id: "knowledge-center-development", key: "development", title: "研发迭代", sequence: 1, input_description: null, output_description: "完成候选知识治理", acceptance_focus: [], roles: [{ role_key: "boss", is_primary: true }, { role_key: "knowledge-executor" }] },
    ],
  }],
  projects: [{
    project: { id: "project-1", module: "project_management", name: "Snail Shell", summary: "Self evolution", project_root: process.cwd() },
    sops: [{ sop_id: "sop-project-1", is_default: true, role_bindings: { "developer": "opencode-default", "reviewer": "opencode-default" } }],
  }, {
    project: { id: "knowledge-center", module: "knowledge_governance", name: "Knowledge Center", summary: "知识中心内置项目", project_root: process.cwd() },
    sops: [{ sop_id: "sop-knowledge-center", is_default: true, role_bindings: { "boss": "opencode-default", "knowledge-executor": "opencode-default" } }],
  }],
});
// seed backfill: 已有 project 的 guard_profile 为 NULL 时应被非破坏性回填
const projectBeforeBackfill = store.getProject("project-1")!;
assert(projectBeforeBackfill.guard_profile === null, "project-1 guard_profile should be null before backfill");
store.seedProjectConfigs({
  sops: [],
  projects: [{
    project: { id: "project-1", module: "project_management", name: "Snail Shell", summary: "Self evolution", project_root: process.cwd(), guard_profile: { database: { mode: "allow" } } },
    sops: [],
  }],
});
const projectAfterBackfill = store.getProject("project-1")!;
assert(projectAfterBackfill.guard_profile !== null, "project-1 guard_profile should be backfilled");
assert((projectAfterBackfill.guard_profile as Record<string, unknown>)["database"] !== undefined, "backfilled guard_profile should have database");
// 再次 seed 同一值不应覆盖（幂等）
store.seedProjectConfigs({
  sops: [],
  projects: [{
    project: { id: "project-1", module: "project_management", name: "Snail Shell", summary: "Self evolution", project_root: process.cwd(), guard_profile: { database: { mode: "deny" } } },
    sops: [],
  }],
});
const projectAfterSecondSeed = store.getProject("project-1")!;
assert(projectAfterSecondSeed.guard_profile !== null, "project-1 guard_profile should still be non-null after second seed");
// 已有非 NULL 值不应被覆盖（非破坏性）
const secondProfile = projectAfterSecondSeed.guard_profile as Record<string, unknown>;
assert(secondProfile["database"] !== undefined, "existing guard_profile should not be overwritten");

const project = store.getProject("project-1")!;
const feature = store.createFeature({ id: "feature-1", projectId: project.id, title: "Feature", summary: "Self evolution" });
const stage = store.createStage({ id: "stage-1", projectId: project.id, featureId: feature.id, stageDefinitionId: "sd-development", type: "development", sequence: 1, status: "in_progress", enteredAt: new Date().toISOString() });
const conversation = store.createConversation({ id: "conversation-1", projectId: project.id, featureId: feature.id, stageId: stage.id, title: "Founding discussion", kind: "discussion", defaultRole: "Owner Snail", participatingRoles: ["Boss Role", "Owner Snail", "Product Snail"], summary: "Initial discussion", fromConversationIds: [] });

function persistCompletedMessage(input: { fromRole: "Boss Role" | "Owner Snail" | null; toRoles: Array<"Owner Snail" | "Boss Role">; role: "user" | "assistant" | "system"; events: CreateMessageEventInput[] }) {
  const message = store.addMessage({ conversationId: conversation.id, fromRole: input.fromRole, toRoles: input.toRoles, role: input.role, runtime: "system", status: "streaming" });
  store.addMessageEvent(message.id, { kind: "start", payload: { role: input.role, role_name: input.fromRole, runtime: "system" }, source: { runtime_name: "system" } });
  input.events.forEach((event) => store.addMessageEvent(message.id, event));
  store.completeMessageWithEvent(message.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed");
  const completed = store.getMessage(message.id)!;
  const context = buildDeterministicMessageContext(completed, store.getMessageEvents(message.id));
  store.upsertMessageContext(message.id, context.kind, context.context);
  store.rebuildDispatchesForMessage(message.id);
  return store.getMessagesByIds(conversation.id, [message.id])[0];
}

const userMessage = persistCompletedMessage({ fromRole: "Boss Role", toRoles: ["Owner Snail"], role: "user", events: [buildPlainTextEvent("你好，Snail Shell")] });
const userDispatches = store.listPendingDispatches(conversation.id, "Owner Snail");
assert(userDispatches.some((dispatch) => dispatch.message_id === userMessage.id), "addMessage should create pending dispatches for toRoles");
const assistantMessage = persistCompletedMessage({
  fromRole: "Owner Snail",
  toRoles: [],
  role: "assistant",
  events: [
    buildPlainTextEvent("你好，我会记录这次演进。"),
    { kind: "error", payload: { source: "runtime", message: "recoverable-runtime-error", detail: null }, source: { runtime_name: "system" } },
  ],
});
assert(assistantMessage.context?.kind === "final_text", "assistant message context should prefer final text over error events");
assert(assistantMessage.context?.context === "你好，我会记录这次演进。", "assistant message context should store the final text only");
const messageOutEvent = buildContentBlockEvent([{ type: "markdown", text: "## PR 交付记录\n最终交付正文", mentions: [] }], "## PR 交付记录\n最终交付正文");
const messageOutAfterProgress = persistCompletedMessage({
  fromRole: "Owner Snail",
  toRoles: [],
  role: "assistant",
  events: [
    buildPlainTextEvent("我会用 `message-out` 生成本阶段 PR 交付记录 payload；这只是结构化内容封装，不会发送额外消息。"),
    { ...messageOutEvent, kind: "text", payload: { text: stringifyMessageOutPart(messageOutEvent), mentions: [] } },
  ],
});
assert(messageOutAfterProgress.context?.kind === "message_out", "message-out text payload appended after progress text should become the final context");
assert(messageOutAfterProgress.context?.context.startsWith("## PR 交付记录"), "message-out context should use fallback text instead of the earlier progress update");
const plainTextAfterMessageOut = persistCompletedMessage({
  fromRole: "Owner Snail",
  toRoles: [],
  role: "assistant",
  events: [messageOutEvent, buildPlainTextEvent("后续自然语言结论")],
});
assert(plainTextAfterMessageOut.context?.kind === "final_text", "plain text appended after message-out should remain eligible as the final context");
assert(plainTextAfterMessageOut.context?.context === "后续自然语言结论", "final context selection should follow persisted event order");
const systemMessage = persistCompletedMessage({ fromRole: null, toRoles: [], role: "system", events: [buildPlainTextEvent("系统通知：进入下一阶段。")] });

const recentMessages = store.getRecentMessages(conversation.id, 5);
assert(recentMessages.some((message) => message.id === assistantMessage.id && message.context?.context === "你好，我会记录这次演进。"), "recent messages used by summary input should include persisted message context");
const messagesSinceProductReply = store.getMessagesSinceRoleReply(conversation.id, "Product Snail");
assert(formatMessageContextForPrompt(messagesSinceProductReply.find((message) => message.id === userMessage.id)!).includes("你好，Snail Shell"), "inbox messages used by agent prompts should include persisted message context");
const messageWindow = store.getMessageWindow(conversation.id, assistantMessage.id, 1, 1);
assert(messageWindow.some((message) => message.id === assistantMessage.id && message.context?.context === "你好，我会记录这次演进。"), "history message window should include persisted message context");

const messages = store.getMessages(conversation.id);
assert(messages.length === 5, "should have 5 messages");
assert(messages[0].events[0].kind === "start", "user message should start with start event");
assert(messages[0].events.some((event) => event.kind === "text"), "user message should persist text event");
assert(messages[0].status === "completed", "user message should be completed");
assert(messages[1].from_role === "Owner Snail", "assistant speaker should be saved");
assert(messages[1].events.some((event) => event.kind === "error"), "assistant error event should be saved");
assert(messages[4].role === "system", "system message should be saved");
assert(renderMessageEventsForDisplay(systemMessage).includes("系统通知：进入下一阶段。"), "system display text should be derived from events");

const clientAckMessage = store.addMessage({ conversationId: conversation.id, clientId: "temp-user-persisted", fromRole: "Boss Role", toRoles: [], role: "user", runtime: "system", status: "streaming" });
assert(store.getMessage(clientAckMessage.id)?.client_id === "temp-user-persisted", "message should persist client_id for optimistic reconciliation");
store.addMessageEvent(clientAckMessage.id, { kind: "start", payload: { role: "user", role_name: "Boss Role", runtime: "system" }, source: { runtime_name: "system" } });
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
  fromRole: "Owner Snail",
  toRoles: [],
  role: "assistant",
  events: [
    { kind: "tool_call", payload: { tool_name: "Read", call_id: "tool-1", input: { filePath: "src/index.ts" }, title: null }, source: { runtime_name: "system" } },
    { kind: "tool_result", payload: { tool_name: "Read", call_id: "tool-1", is_error: true, output_text: null, error_text: "missing file", metadata: null }, source: { runtime_name: "system" } },
  ],
});
assert(eventSummaryMessage.context?.kind === "event_summary", "message without final text should summarize event stream");
assert(eventSummaryMessage.context?.context.includes("missing file"), "event summary should include key error detail");

const invalidMessage = store.addMessage({ conversationId: conversation.id, fromRole: "Boss Role", toRoles: [], role: "user", runtime: "system", status: "streaming" });
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
  store.addMessageEvent(userMessage.id, { kind: "start", payload: { role: "user", role_name: "Boss Role", runtime: "system" } });
} catch {
  rejectedTerminalAppend = true;
}
assert(rejectedTerminalAppend, "terminal messages must reject all new events");

const secondUserMessage = persistCompletedMessage({ fromRole: "Boss Role", toRoles: ["Owner Snail"], role: "user", events: [buildPlainTextEvent("第二轮用户消息")] });
const secondAssistantMessage = persistCompletedMessage({ fromRole: "Owner Snail", toRoles: [], role: "assistant", events: [buildPlainTextEvent("第二轮助手回复")] });
const thirdUserMessage = persistCompletedMessage({ fromRole: "Boss Role", toRoles: ["Owner Snail"], role: "user", events: [buildPlainTextEvent("第三轮用户消息")] });
const thirdAssistantMessage = persistCompletedMessage({ fromRole: "Owner Snail", toRoles: [], role: "assistant", events: [buildPlainTextEvent("第三轮助手回复")] });
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

store.updateStage(stage.id, { output_artifacts: { pr_url: "PR #1 已合并" } });
assert(store.getStage(stage.id)!.output_artifacts["pr_url"] === "PR #1 已合并", "output artifacts should be saved");

const candidateKnowledge = store.createKnowledge({
  id: "knowledge-1",
  projectId: project.id,
  scopeType: "project",
  scopeRef: project.id,
  kind: "decision",
  title: "知识必须人工审批",
  content: "候选知识不得自动反哺，必须经过人工审批后才能进入 active 状态。approval-gate",
  rationale: "知识会影响后续 agent 行为，审批是治理边界。",
  createdBy: "Boss Role",
  sources: [{ id: "knowledge-source-1", sourceType: "message", sourceId: String(userMessage.id), quote: "知识必须人工审批" }],
});
assert(candidateKnowledge.status === "candidate", "new knowledge should default to candidate status");
assert(candidateKnowledge.governance?.entry_check_status === "pending_entry_check", "candidate knowledge should create an entry-check governance record");
assert(candidateKnowledge.governance?.conversation?.participating_roles.includes("Boss Role"), "governance conversation should include Boss Role");
const persistedGovernanceConversation = store.getConversation(candidateKnowledge.governance!.conversation!.id)!;
assert(persistedGovernanceConversation.owner_type === "knowledge_governance", "governance conversation should be exposed with knowledge owner semantics");
assert(persistedGovernanceConversation.project_id === "knowledge-center" && persistedGovernanceConversation.feature_id !== null && persistedGovernanceConversation.stage_id !== null, "governance conversation should own real knowledge-center project feature and stage");
assert(store.listConversationsByOwner("knowledge_governance", candidateKnowledge.governance!.id).some((item) => item.id === persistedGovernanceConversation.id), "governance conversation should be persisted in the unified conversation table");
assert(candidateKnowledge.sources[0].source_id === String(userMessage.id), "knowledge should preserve source traceability");
assert(store.listKnowledge({ projectId: project.id, status: "candidate" }).some((item) => item.id === candidateKnowledge.id), "candidate knowledge should be listable by project and status");
assert(store.searchKnowledge({ query: "approval-gate", projectId: project.id }).some((item) => item.id === candidateKnowledge.id), "knowledge should be searchable by FTS");
assert(!store.listFeatures(project.id).some((item) => item.id === candidateKnowledge.governance?.id), "knowledge governance must not be inserted into project feature list");
const governanceMessage = store.addMessage({ conversationId: persistedGovernanceConversation.id, fromRole: "Boss Role", toRoles: ["研发者"], role: "user", runtime: "system", status: "streaming" });
assert(governanceMessage.id > 0, "governance messages should expose conversation-local positive ids");
store.addMessageEvent(governanceMessage.id, { kind: "start", payload: { role: "user", role_name: "Boss Role", runtime: "system" }, source: { runtime_name: "system" } }, persistedGovernanceConversation.id);
const governanceTextEvent = store.addMessageEvent(governanceMessage.id, buildPlainTextEvent("请治理这条知识"), persistedGovernanceConversation.id);
store.completeMessageWithEvent(governanceMessage.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed", persistedGovernanceConversation.id);
store.rebuildDispatchesForMessage(governanceMessage.id, persistedGovernanceConversation.id);
assert(store.getMessages(persistedGovernanceConversation.id)[0].id === governanceMessage.id, "governance messages should be readable through the store facade");
assert(governanceTextEvent.id > 0, "governance message events should expose conversation-local positive cursors");
assert(store.getLastMessageEventId(persistedGovernanceConversation.id) > 0, "governance event cursors should be scoped by conversation");
assert(store.getMessageEventsAfter(persistedGovernanceConversation.id, 0).some((event) => event.id === governanceTextEvent.id), "governance events should be read by conversation-local cursor");
const governanceDispatch = store.listPendingDispatches(persistedGovernanceConversation.id, "研发者").find((dispatch) => dispatch.message_id === governanceMessage.id);
assert(governanceDispatch?.id && governanceDispatch.id > 0, "governance dispatches should expose conversation-local positive ids");
if (!governanceDispatch) throw new Error("governance dispatch should exist for collision regression");
const governanceAssistantMessage = store.addMessage({ conversationId: persistedGovernanceConversation.id, fromRole: "研发者", toRoles: [], role: "assistant", runtime: "system", status: "streaming" });
store.addMessageEvent(governanceAssistantMessage.id, { kind: "start", payload: { role: "assistant", role_name: "研发者", runtime: "system" }, source: { runtime_name: "system" } }, persistedGovernanceConversation.id);
store.addMessageEvent(governanceAssistantMessage.id, buildPlainTextEvent("治理会话里的旧文本"), persistedGovernanceConversation.id);
store.completeMessageWithEvent(governanceAssistantMessage.id, { kind: "signal", payload: { type: "message_completed", reason: null, detail: null }, source: { runtime_name: "system" } }, "completed", persistedGovernanceConversation.id);
const collidingProtocolMessage = createStreamingContext({
  deps: {
    emitAgentEvent: () => {},
    updateSnailAgentSessionExternalId: () => {},
    store,
  },
  conversationId: persistedGovernanceConversation.id,
  activeRole: { name: "研发者", description: "", snail_template_id: "opencode-default", is_primary: 1, id: "sr-impl", project_id: "project-1", stage_definition_id: "sd-development", working_rules: [], created_at: "", updated_at: "" },
  resolvedRuntime: "system",
  contextCutoffAt: String(governanceAssistantMessage.id),
  snailAgentSessionId: "test-session-persist",
});
store.addMessageEvent(collidingProtocolMessage.session.assistantMessageId, buildPlainTextEvent("治理协议收尾消息"), persistedGovernanceConversation.id);
assert(collidingProtocolMessage.session.assistantMessageId > governanceAssistantMessage.id, "governance protocol message should reuse a local id that can collide with project message ids");
const crossConversationMessage = store.getMessage(collidingProtocolMessage.session.assistantMessageId, conversation.id);
assert(crossConversationMessage === null, "unified message table should not confuse governance message ids with project conversation scope");
const protocolCollisionRegression = finalizeMessageLifecycle(collidingProtocolMessage, { status: "completed", finalRole: "assistant" }).then(() => {
  const governanceProtocolMessage = store.getMessage(collidingProtocolMessage.session.assistantMessageId, persistedGovernanceConversation.id);
  assert(governanceProtocolMessage?.conversation_id === persistedGovernanceConversation.id, "message protocol finalization should resolve the governance message inside its conversation");
  const governanceProtocolContext = store.getMessageContext(collidingProtocolMessage.session.assistantMessageId, persistedGovernanceConversation.id);
  assert(governanceProtocolContext?.context === "治理协议收尾消息", "message protocol finalization should persist governance context inside its conversation");
});
const collidingProjectMessage = persistCompletedMessage({ fromRole: "Owner Snail", toRoles: ["Boss Role"], role: "assistant", events: [buildTextEvent("请 @Boss Role 处理 dispatch 碰撞", ["Boss Role"])] });
const collidingProjectDispatch = store.listBossPendingDispatches(conversation.id).find((dispatch) => dispatch.message_id === collidingProjectMessage.id);
if (!collidingProjectDispatch) throw new Error("project Boss dispatch should exist");
store.markConversationDispatchesSeen(conversation.id, [collidingProjectDispatch.id]);
assert(store.listDispatches(conversation.id).find((dispatch) => dispatch.id === collidingProjectDispatch.id)?.status === "seen", "project dispatch should be marked seen in its own conversation");
assert(store.listDispatches(persistedGovernanceConversation.id).find((dispatch) => dispatch.id === governanceDispatch.id)?.status === "pending", "project dispatch updates must not affect governance dispatches");
store.skipConversationDispatches(persistedGovernanceConversation.id, [governanceDispatch.id]);
assert(store.listDispatches(persistedGovernanceConversation.id).find((dispatch) => dispatch.id === governanceDispatch.id)?.status === "skipped", "governance dispatch ids should route through explicit conversation ownership");
const directActiveKnowledge = store.createKnowledge({ id: "knowledge-direct-active", projectId: project.id, scopeType: "project", scopeRef: project.id, kind: "constraint", status: "active", title: "存储层允许迁移导入 active 知识", content: "只有受控调用方可以直接写入 active。" });
assert(directActiveKnowledge.status === "active", "store should keep direct active creation available for trusted migrations");
const approvedKnowledge = store.approveKnowledge(candidateKnowledge.id, { reviewer: "Boss Role", updates: { governance_level: "L2" } });
assert(approvedKnowledge.status === "active", "approved knowledge should become active");
store.updateKnowledgeGovernance(candidateKnowledge.governance!.id, { entryCheckStatus: "entry_check_passed", dedupeStatus: "unique", scenarioType: "new_knowledge_review", dispositionStatus: "landed", artifactType: "system_prompt_pr", governancePrUrl: "https://github.com/example/snail-shell/pull/1", finalDestination: ".meta/prompts/prompts/B-02-知识治理.md", runtimeFeedbackAllowed: true, runtimeFeedbackChannels: ["prompt"] });
const knowledgeUse = store.recordKnowledgeUse({ id: "knowledge-use-1", knowledgeId: approvedKnowledge.id, conversationId: conversation.id, stageId: stage.id, roleName: "Owner Snail", useType: "manual_reference" });
assert(knowledgeUse.use_type === "manual_reference", "knowledge use should record use type");
assert(store.listKnowledgeUses(approvedKnowledge.id).length === 1, "manual use history should be queryable");

const mentionMessage = persistCompletedMessage({ fromRole: "Owner Snail", toRoles: ["Boss Role"], role: "assistant", events: [buildTextEvent("请 @Boss Role 确认一下这个方案", ["Boss Role"])] });
assert(mentionMessage.events.some((event) => event.kind === "text" && event.payload.mentions.includes("Boss Role")), "mentions should be stored on text events");
const bossPendingDispatches = store.listBossPendingDispatches(conversation.id);
assert(bossPendingDispatches.length === 1, "should have 1 pending Boss Role dispatch");

protocolCollisionRegression.then(() => {
  store.close();
  fs.unlinkSync(TEST_DB);
  console.log("persistence tests passed");
}).catch((error) => {
  store.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.error(error);
  process.exitCode = 1;
});
