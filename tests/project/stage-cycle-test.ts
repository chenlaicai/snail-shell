import assert from "assert";
import fs from "fs";
import path from "path";
import { ProjectManager } from "../../src/project-workflow/manager";
import { ConversationStore } from "../../src/persistence/store";
import { buildPlainTextEvent } from "../../src/message-bus/message-events";
import { SnailRegistry } from "../../src/snails";
import type { AgentEvent, AgentRuntime, SnailRuntimeMessageInput } from "../../src/agent/interface";
import type { AgentSnailDefinition } from "../../src/snails";
import type { SnailDen } from "../../src/snail-den";
import type { StageDefinitionInput } from "../../src/project-workflow/workflow";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-stage-cycle.db");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

const DEFAULT_STAGE_DEFINITIONS: StageDefinitionInput[] = [
  {
    key: "development",
    title: "研发迭代",
    sequence: 1,
    output_description: "交付 PR",
    acceptance_focus: ["代码通过 CI", "PR 已合并"],
    roles: [{ snail_id: "Implementation Snail", is_primary: true, working_rules: ["先写测试再实现"] }],
  },
  {
    key: "review",
    title: "PR 检视",
    sequence: 2,
    input_description: "上一阶段产出的 PR",
    output_description: "检视完成",
    acceptance_focus: ["无遗留 comment", "检视通过"],
    roles: [
      { snail_id: "Implementation Snail", is_primary: true, working_rules: ["回应所有 comment"] },
      { snail_id: "Acceptance Snail", is_primary: false, working_rules: ["验证验收条件"] },
    ],
  },
];

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const store = new ConversationStore(TEST_DB);
const snailRegistry = new SnailRegistry();
const runtimeCalls: AgentRuntime[] = [];
const runtimeInputs: string[] = [];
const systemPromptInputs: string[] = [];
const manager = new ProjectManager(
  store,
  {
    resolve(snail: AgentSnailDefinition) {
      runtimeCalls.push(snail.runtime);
      return {
        name: snail.runtime,
        runtime: snail.runtime,
        invokeMessage: async (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          runtimeInputs.push(input.latestUserEvents.map((event) => event.kind === "text" ? event.payload.text : "").join("\n"));
          systemPromptInputs.push(input.systemPrompts.conversation);
          if (input.latestUserEvents.some((event) => event.kind === "text" && event.payload.text === "first")) await sleep(20);
          onEvent({ type: "message_event", event: { kind: "text", payload: { text: `handled by ${input.snail.runtime}`, mentions: [] } } });
          return {};
        },
      };
    },
    list: () => [],
  },
  {
    snailRegistry,
    systemAI: { generateConversationSummary: async () => "summary", generateMessageContextSummary: async (input: { context: string; targetChars: number }) => input.context.slice(0, input.targetChars), extractMentions: async () => ({ mentions: [] }) },
    snailDen: { getTemplate: () => undefined, listTemplates: () => [], getSnailRuntime: () => { throw new Error("not implemented"); } } as unknown as SnailDen,
  },
);

run().catch((error) => {
  throw error;
});

async function run(): Promise<void> {
  try {
    const created = manager.createProject("Stage Cycle Test", "test", "system_self", DEFAULT_STAGE_DEFINITIONS);
    assert.equal(created.conversation.default_snail, "Implementation Snail", "development should start with implementation snail");

    const candidateKnowledge = manager.createKnowledge({
      projectId: created.project.id,
      scopeType: "project",
      scopeRef: created.project.id,
      kind: "rule",
      title: "治理裁决后确认 active",
      content: "批准后的知识必须先有治理裁决允许 prompt 通道。",
    });
    const governanceConversation = store.getConversation(candidateKnowledge.governance!.conversation!.id)!;
    assert.equal(governanceConversation.owner_type, "knowledge_governance", "governance conversation should use the knowledge governance owner");
    assert.equal(governanceConversation.project_id, null, "governance conversation should not fake a project owner");
    await manager.sendMessage(governanceConversation.id, "开始治理这条候选知识");
    assert.equal(store.getMessages(governanceConversation.id)[0].id > 0, true, "governance messages should expose conversation-local positive ids");
    assert(runtimeInputs.some((input) => input.includes("开始治理这条候选知识")), "governance conversation should run through the normal agent message pipeline");
    assert(systemPromptInputs.some((input) => input.includes("知识治理上下文") && input.includes(candidateKnowledge.id) && input.includes("软件只负责提取候选知识、打开治理对话和提供回写入口")), "governance conversation prompt should include candidate context and AI-driven governance boundary");
    manager.updateKnowledgeGovernance(candidateKnowledge.governance!.id, { runtimeFeedbackAllowed: true, runtimeFeedbackChannels: ["prompt"] });
    const activeKnowledge = manager.approveKnowledge(candidateKnowledge.id, { reviewer: "Boss Snail" });
    assert.equal(activeKnowledge.status, "active", "manager approval should set knowledge to active");

    await manager.sendMessage(created.conversation.id, "hello");
    assert(runtimeCalls.includes("opencode-cli"), "implementation snail should use opencode runtime");

    store.updateStage(created.stage.id, { output_artifacts: ["PR #1 已合并"] });

    const review = manager.advanceFeature(created.feature.id);
    assert.equal(review.next_stage?.type, "review", "development should advance to review");
    assert.equal(review.feature.status, "in_review", "feature should enter review status");

    store.updateStage(review.next_stage!.id, { output_artifacts: ["检视通过"] });

    const waitingMerge = manager.advanceFeature(created.feature.id);
    assert.equal(waitingMerge.completed_stage.id, review.next_stage!.id, "review stage should be completed");
    assert.equal(waitingMerge.next_stage, null, "review completion should not auto-create another stage");
    assert.equal(waitingMerge.feature.status, "waiting_merge", "feature should wait for user merge after review");

    const parallelFeature = manager.createFeature(created.project.id, "Parallel Feature", "test parallel work");
    assert.equal(parallelFeature.stage.type, "development", "new feature should start independent development");
    assert.equal(manager.getFeature(created.feature.id)!.status, "waiting_merge", "new feature must not disturb completed feature state");

    const archivedParallelFeature = manager.archiveFeature(parallelFeature.feature.id);
    assert.equal(archivedParallelFeature.feature.status, "archived", "archiving should persist the feature archive status");
    assert(archivedParallelFeature.feature.closed_at, "archiving should mark the feature closed for traceability");
    assert.equal(archivedParallelFeature.cleanup.steps.find((step) => step.target === "worktree")?.status, "skipped", "archiving should report missing worktree cleanup state");
    assert.equal(archivedParallelFeature.cleanup.steps.find((step) => step.target === "branch")?.status, "skipped", "archiving should report missing branch cleanup state");
    assert.equal(manager.getFeature(parallelFeature.feature.id)!.status, "archived", "archived feature should remain readable from the manager");
    assert.throws(
      () => manager.completeFeature(parallelFeature.feature.id),
      /Archived feature is read-only/,
      "archived feature must not be overwritten by lifecycle completion"
    );
    assert.throws(
      () => manager.advanceFeature(parallelFeature.feature.id),
      /Archived feature is read-only/,
      "archived feature must not advance workflow"
    );
    assert.throws(
      () => manager.createConversation({ projectId: created.project.id, featureId: parallelFeature.feature.id, stageId: parallelFeature.stage.id, title: "Archived Conversation", kind: "discussion" }),
      /Archived feature is read-only/,
      "archived feature must not accept new conversations"
    );
    await assert.rejects(
      () => manager.sendMessage(parallelFeature.conversation.id, "after archive"),
      /Archived feature is read-only/,
      "archived feature conversations must reject new messages"
    );

    const freshDevelopment = manager.restartFeatureDevelopment(created.feature.id, review.next_stage!.id);
    assert.equal(freshDevelopment.completed_stage.id, review.next_stage!.id, "review stage should be restart source");
    assert.equal(freshDevelopment.next_stage!.type, "development", "restart should create a new development stage");
    assert.equal(freshDevelopment.next_stage!.sequence, 3, "restart should append a fresh feature-local stage instance");
    assert.equal(freshDevelopment.conversation!.default_snail, "Implementation Snail", "fresh development cycle should use implementation snail");
    assert.deepEqual(freshDevelopment.conversation!.from_conversation_ids, [review.conversation!.id], "fresh development should carry review context");

    store.updateStage(freshDevelopment.next_stage!.id, { output_artifacts: ["PR #2 已合并"] });

    const secondReview = manager.advanceFeature(created.feature.id);
    assert.equal(secondReview.next_stage!.type, "review", "second development should advance to review");

    assert.throws(
      () => manager.restartFeatureDevelopment(created.feature.id, review.next_stage!.id),
      /does not match latest feature stage/,
      "restart should reject stale stage ids"
    );

    const repoFeature = manager.createFeature(created.project.id, "Repo Context Feature", "test repo context");
    const updatedRepoFeature = manager.updateFeatureRepoContext(repoFeature.feature.id, {
      branchName: "feature/repo-context-test",
      worktreePath: path.join(process.cwd(), "..", "snail-shell-worktrees", "repo-context-test"),
      prUrl: "https://github.com/chenlaicai/snail-shell/pull/1",
    });
    assert.equal(updatedRepoFeature.branch_name, "feature/repo-context-test", "feature should record branch name for completion cleanup");
    assert.equal(updatedRepoFeature.pr_url, "https://github.com/chenlaicai/snail-shell/pull/1", "feature should record PR URL for traceability");

    const completedRepoFeature = manager.completeFeature(repoFeature.feature.id);
    assert.equal(completedRepoFeature.feature.status, "completed", "completion endpoint should return completed feature");
    assert.equal(completedRepoFeature.cleanup.steps.find((step) => step.target === "worktree")?.status, "skipped", "missing recorded worktree should be reported without failing completion");
    assert.equal(completedRepoFeature.cleanup.steps.find((step) => step.target === "branch")?.status, "skipped", "missing recorded branch should be reported without failing completion");

    await testManagerSerializesConversationMessages();
    testManagerMessagePaginationContracts();
  } finally {
    store.close();
    removeDbFiles(TEST_DB);
  }

  console.log("stage-cycle tests passed");
}

async function testManagerSerializesConversationMessages(): Promise<void> {
  runtimeInputs.length = 0;
  const created = manager.createProject("Serialization Test", "test", "system_self", DEFAULT_STAGE_DEFINITIONS);
  const first = manager.sendMessage(created.conversation.id, "first");
  const second = manager.sendMessage(created.conversation.id, "second");
  await Promise.all([first, second]);
  const latestInputs = runtimeInputs.slice(-2);
  assert(latestInputs[0]?.includes("first") && !latestInputs[0]?.includes("second"), "first queued message should invoke with isolated pending input");
  assert(latestInputs[1]?.includes("second") && !latestInputs[1]?.includes("first"), "second queued message should invoke after the first without merging input");
}

function testManagerMessagePaginationContracts(): void {
  const created = manager.createProject("Recent Messages Test", "test", "system_self", DEFAULT_STAGE_DEFINITIONS);
  const streaming = store.addMessage({ conversationId: created.conversation.id, fromSnail: "Owner Snail", toSnails: [], role: "assistant", runtime: "system", status: "streaming", contextCutoffAt: "0" });
  const messageIds = Array.from({ length: 5 }, () => store.addMessage({ conversationId: created.conversation.id, fromSnail: "Boss Snail", toSnails: [], role: "user", runtime: "system", status: "completed", contextCutoffAt: String(store.getMessages(created.conversation.id).at(-1)?.id ?? 0) }).id);
  const firstPage = manager.getConversationMessages(created.conversation.id, 3, 0).map((message) => message.id);
  const secondPage = manager.getConversationMessages(created.conversation.id, 3, 3).map((message) => message.id);
  const recentSnapshot = manager.getRecentConversationMessages(created.conversation.id, 3);
  const recent = recentSnapshot.items.map((message) => message.id);
  assert.deepEqual(firstPage, [streaming.id, ...messageIds.slice(0, 2)], "messages endpoint should keep oldest-first pagination");
  assert.deepEqual(secondPage, messageIds.slice(2), "messages endpoint offset should continue the same oldest-first sequence");
  assert(messageIds.slice(-3).every((id) => recent.includes(id)), "recent messages endpoint should include the latest completed window in display order");
  assert(recent.includes(streaming.id), "recent messages endpoint should include active streaming messages even outside the fixed window");
  assert(Number.isInteger(recentSnapshot.last_event_id), "recent messages endpoint should expose an event cursor");

  store.addMessageEvent(streaming.id, { kind: "start", payload: { role: "assistant", snail_name: "Owner Snail", runtime: "system" } });
  const beforeBackfill = manager.getLastConversationEventId(created.conversation.id);
  const backfilledEvent = store.addMessageEvent(streaming.id, buildPlainTextEvent("backfill boundary"));
  const afterBackfill = manager.getLastConversationEventId(created.conversation.id);
  assert(manager.getConversationEventsBetween(created.conversation.id, 0, afterBackfill).some((event) => event.id === backfilledEvent.id), "bounded backfill should treat cursor 0 as a valid request from the beginning of the timeline");
  assert(manager.getConversationEventsBetween(created.conversation.id, beforeBackfill, beforeBackfill).length === 0, "bounded backfill should not include events above its subscription watermark");
  assert(manager.getConversationEventsBetween(created.conversation.id, beforeBackfill, afterBackfill).some((event) => event.id === backfilledEvent.id), "bounded backfill should include events up to the subscription watermark");
}
