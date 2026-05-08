import assert from "assert";
import fs from "fs";
import path from "path";
import { ProjectManager } from "../../src/project/manager";
import { ConversationStore } from "../../src/persistence/store";
import { buildPlainTextEvent } from "../../src/project/message-events";
import { SnailRegistry } from "../../src/snails";
import type { AgentEvent, AgentRuntime, SnailRuntimeMessageInput } from "../../src/agent/interface";
import type { AgentSnailDefinition } from "../../src/snails";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-stage-cycle.db");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const store = new ConversationStore(TEST_DB);
const snailRegistry = new SnailRegistry();
const runtimeCalls: AgentRuntime[] = [];
const runtimeInputs: string[] = [];
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
          if (input.latestUserEvents.some((event) => event.kind === "text" && event.payload.text === "first")) await sleep(20);
          onEvent({ type: "message_event", event: { kind: "text", payload: { text: `handled by ${input.snail.runtime}`, mentions: [] } } });
          return {};
        },
      };
    },
    list: () => [],
  },
  snailRegistry,
  { generateConversationSummary: async () => "summary", generateMessageContextSummary: async (input) => input.context.slice(0, input.targetChars) },
  { extractMentions: async () => ({ mentions: [] }) }
);

run().catch((error) => {
  throw error;
});

async function run(): Promise<void> {
  try {
    const created = manager.createProject("Stage Cycle Test", "test", "system_self");
    assert.equal(created.conversation.default_snail, "Implementation Snail", "development should start with implementation snail");

    const candidateKnowledge = manager.createKnowledge({
      projectId: created.project.id,
      scopeType: "project",
      scopeRef: created.project.id,
      kind: "rule",
      title: "批准后创建落地请求",
      content: "批准后的知识必须通过 PR 落成文档，重启同步后才进入运行时。",
    });
    const activeKnowledge = manager.approveKnowledge(candidateKnowledge.id, { reviewer: "Boss Snail" });
    assert.equal(activeKnowledge.runtime_state, "inactive", "manager approval should not make knowledge runtime-active before document sync");
    assert(activeKnowledge.metadata?.includes("approved_for_pr_request_id"), "manager approval should link the candidate to a knowledge landing request");

    const conservativeKnowledge = manager.createKnowledge({
      projectId: created.project.id,
      scopeType: "project",
      scopeRef: created.project.id,
      kind: "fact",
      title: "普通事实默认不注入",
      content: "普通 L0 事实应具备策略记录，但不能默认污染系统提示词上下文。",
    });
    const approvedConservativeKnowledge = manager.approveKnowledge(conservativeKnowledge.id, { reviewer: "Boss Snail" });
    assert.equal(approvedConservativeKnowledge.runtime_state, "inactive", "manager approval should keep non-document knowledge inactive");
    const injectableKnowledge = store.listPromptInjectableKnowledge({ projectId: created.project.id, featureId: created.feature.id, stageType: created.stage.type, snailName: "Implementation Snail" });
    assert(!injectableKnowledge.some((item) => item.id === approvedConservativeKnowledge.id), "database-only approved knowledge should not enter prompt injection candidates");

    const constrainedKnowledge = manager.createKnowledge({
      projectId: created.project.id,
      scopeType: "project",
      scopeRef: created.project.id,
      kind: "rule",
      title: "显式策略优先",
      content: "审批不应覆盖用户提前设置的反哺策略。",
    });
    manager.upsertKnowledgeUsagePolicy(constrainedKnowledge.id, { allowPromptInjection: false, promptMode: "none", stageTypes: ["development"], snailNames: ["Implementation Snail"], priority: 77 });
    const approvedConstrainedKnowledge = manager.approveKnowledge(constrainedKnowledge.id, { reviewer: "Boss Snail" });
    assert.equal(approvedConstrainedKnowledge.usage_policy?.allow_prompt_injection, false, "manager approval should preserve explicit prompt injection flag");
    assert.equal(approvedConstrainedKnowledge.usage_policy?.stage_types[0], "development", "manager approval should preserve explicit stage policy");
    assert.equal(approvedConstrainedKnowledge.usage_policy?.snail_names[0], "Implementation Snail", "manager approval should preserve explicit snail policy");
    assert.equal(approvedConstrainedKnowledge.usage_policy?.priority, 77, "manager approval should preserve explicit priority");

    await manager.sendMessage(created.conversation.id, "hello");
    assert(runtimeCalls.includes("opencode-cli"), "implementation snail should use opencode runtime");

    const developmentArtifact = manager.createArtifact(created.conversation.id, "pull_request_record", "PR", {
      status: "active",
      options: { inlineContent: "PR ready" },
    });
    assert.equal(developmentArtifact.title, "PR", "manager-level artifact creation should preserve explicit internal titles");
    manager.setStageFormalArtifacts(created.stage.id, [developmentArtifact.id]);

    const review = manager.advanceFeature(created.feature.id);
    assert.equal(review.next_stage?.type, "review", "development should advance to review");
    assert.equal(review.feature.status, "in_review", "feature should enter review status");

    const reviewArtifact = manager.createArtifact(review.conversation!.id, "review_completion_record", "Review", {
      status: "active",
      options: { inlineContent: "No pending issues" },
    });
    manager.setStageFormalArtifacts(review.next_stage!.id, [reviewArtifact.id]);

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
    assert.throws(
      () => manager.createArtifact(parallelFeature.conversation.id, "pull_request_record", "Archived Artifact"),
      /Archived feature is read-only/,
      "archived feature must not accept new artifacts"
    );
    assert.throws(
      () => manager.setStageFormalArtifacts(parallelFeature.stage.id, []),
      /Archived feature is read-only/,
      "archived feature must not mutate formal artifacts"
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

    const secondDevelopmentArtifact = manager.createArtifact(freshDevelopment.conversation!.id, "pull_request_record", "PR 2", {
      status: "active",
      options: { inlineContent: "PR ready again" },
    });
    manager.setStageFormalArtifacts(freshDevelopment.next_stage!.id, [secondDevelopmentArtifact.id]);

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
  const created = manager.createProject("Serialization Test", "test", "system_self");
  const first = manager.sendMessage(created.conversation.id, "first");
  const second = manager.sendMessage(created.conversation.id, "second");
  await Promise.all([first, second]);
  const latestInputs = runtimeInputs.slice(-2);
  assert(latestInputs[0]?.includes("first") && !latestInputs[0]?.includes("second"), "first queued message should invoke with isolated pending input");
  assert(latestInputs[1]?.includes("second") && !latestInputs[1]?.includes("first"), "second queued message should invoke after the first without merging input");
}

function testManagerMessagePaginationContracts(): void {
  const created = manager.createProject("Recent Messages Test", "test", "system_self");
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
