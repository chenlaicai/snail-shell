import assert from "assert";
import fs from "fs";
import path from "path";
import { WorkspaceManager } from "../../src/workspace-workflow/manager";
import { ConversationStore } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/roles";
import { upsertSopFromYaml } from "../../src/persistence/sop-model";
import { buildPlainTextEvent } from "../../src/message-bus/message-events";
import type { AgentEvent, AgentRuntime, SnailRuntimeMessageInput } from "../../src/agent/interface";
import type { SnailDen } from "../../src/snail-den";
import type { WorkspaceSeedItem } from "../../src/persistence/workspace-config-model";

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

/** 确保 .snail 目录存在，buildConversationCapability 通过 loadWorkspaceContext 依赖它 */
const snailDir = path.join(process.cwd(), ".snail");
if (!fs.existsSync(snailDir)) {
  fs.mkdirSync(snailDir, { recursive: true });
  fs.writeFileSync(path.join(snailDir, "workspace.json"), JSON.stringify({ name: "Test Workspace" }), "utf8");
}

const store = new ConversationStore(TEST_DB);
const db = store.getDb();

/* 直接在数据库中创建测试 SOP（模拟从 YAML 加载） */
upsertSopFromYaml(db, { id: "sop-test", source: "platform", sourceRef: null, key: "test-sop", name: "Test SOP", description: null }, [
  { key: "design", title: "需求对齐与设计", sequence: 1, input_description: "用户需求", output_description: "Issue 文档", acceptance_focus: ["设计方案已锁定"], roles: [{ key: "designer", name: "设计者", description: "designer", is_primary: true, working_rules: ["独立分析需求"] }] },
  { key: "development", title: "研发实现", sequence: 2, input_description: "锁定的 Issue 文档", output_description: "交付 PR", acceptance_focus: ["代码通过 CI", "PR 已合并"], roles: [{ key: "developer", name: "研发者", description: "dev", is_primary: true, working_rules: ["先写测试再实现"] }] },
  { key: "review", title: "PR 检视", sequence: 3, input_description: "上一阶段产出的 PR", output_description: "检视完成", acceptance_focus: ["无遗留 comment", "检视通过"], roles: [{ key: "developer", name: "研发者", description: "dev", is_primary: true, working_rules: ["回应所有 comment"] }, { key: "reviewer", name: "检视者", description: "rev", working_rules: ["验证验收条件"] }] },
  { key: "merge", title: "合入", sequence: 4, input_description: "已通过检视的 PR", output_description: "合入确认", acceptance_focus: ["PR 基于最新 main", "CI 通过"], roles: [{ key: "merger", name: "合入者", description: "merger", is_primary: true, working_rules: ["检查硬性条件"] }] },
]);

upsertSopFromYaml(db, { id: "sop-evolution-stage-cycle", source: "platform", sourceRef: null, key: "evolution-stage-cycle-sop", name: "Evolution Center SOP", description: null }, [
  { key: "development", title: "演进治理", sequence: 1, input_description: null, output_description: "完成演进工作区治理", acceptance_focus: [], roles: [{ key: "boss", name: "Boss Role", description: "最终决策者，确认治理结论", is_primary: true, working_rules: ["以数据为依据做决策", "治理结论需明确落地入口"] }, { key: "evolution-executor", name: "演进执行者", description: "负责执行演进治理流程：入口校验、查重、裁决去向跟踪", working_rules: ["严格按入口校验流程", "查重需覆盖全局演进工作区库", "裁决去向必须明确并记录PR链接"] }] },
]);

/* Seed workspace 绑定 */
const evolutionWorkspaceSeed: WorkspaceSeedItem = {
  workspace: { id: "evolution-center", module: "evolution", name: "Evolution Center", summary: "演进中心内置工作区", workspace_root: process.cwd() },
  sops: [{ sop_id: "sop-evolution-stage-cycle", is_default: true, role_bindings: { "boss": "opencode-default", "evolution-executor": "opencode-default" } }],
};
store.seedWorkspaceConfigs({ workspaces: [evolutionWorkspaceSeed] });

const roleRegistry = new RoleRegistry(store);
const runtimeInputs: string[] = [];
const systemPromptInputs: string[] = [];
const systemReminderInputs: string[] = [];
const manager = new WorkspaceManager(
  store,
  {
    resolve(runtime: AgentRuntime) {
      return {
        name: runtime,
        runtime,
        invokeMessage: async (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          runtimeInputs.push(input.latestUserEvents.map((event) => event.kind === "text" ? event.payload.text : "").join("\n"));
          systemPromptInputs.push(input.capability.systemPrompt);
          systemReminderInputs.push(input.capability.systemReminder);
          if (input.latestUserEvents.some((event) => event.kind === "text" && event.payload.text === "first")) await sleep(20);
          onEvent({ type: "message_event", event: { kind: "text", payload: { text: `handled by ${runtime}`, mentions: [] } } });
          return {};
        },
      };
    },
    list: () => [],
  },
  {
    roleRegistry,
    systemAI: { generateConversationSummary: async () => "summary", generateMessageContextSummary: async (input: { context: string; targetChars: number }) => input.context.slice(0, input.targetChars), extractMentions: async () => ({ mentions: [] }) },
    snailDen: {
      getTemplate: (id: string) => ({ id, name: id, runtime: "opencode-cli" as AgentRuntime, model: "default", contextProvider: "shell" as const }),
      listTemplates: () => [],
      getSnailRuntime: (templateId: string) => ({
        runtime: {
          name: templateId,
          runtime: "opencode-cli" as AgentRuntime,
          invokeMessage: async (input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
            runtimeInputs.push(input.latestUserEvents.map((event) => event.kind === "text" ? event.payload.text : "").join("\n"));
            systemPromptInputs.push(input.capability.systemPrompt);
            systemReminderInputs.push(input.capability.systemReminder);
            if (input.latestUserEvents.some((event) => event.kind === "text" && event.payload.text === "first")) await sleep(20);
            onEvent({ type: "message_event", event: { kind: "text", payload: { text: `handled by ${templateId}`, mentions: [] } } });
            return {};
          },
        },
        model: "default",
        contextWindow: null,
        template: { id: templateId, name: templateId, runtime: "opencode-cli" as AgentRuntime, model: "default", contextProvider: "shell" as const },
      }),
    } as unknown as SnailDen,
  },
);

run().catch((error) => {
  throw error;
});

async function run(): Promise<void> {
  try {
    const created = manager.createWorkspace("Stage Cycle Test", { summary: "test", workspaceRoot: process.cwd(), sopId: "sop-test", roleBindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } });
    assert.equal(created.stage.type, "design", "issue should start with design stage");
    assert.equal(created.conversation.default_role, "设计者", "design should start with designer");
    const defaultSop = store.getDefaultWorkspaceSop(created.workspace.id);
    assert.ok(defaultSop, "workspace should have a default SOP from seedStageDefinitionsForWorkspace");
    assert.equal(created.issue.adopted_sop_id, defaultSop!.sop_id, "issue should adopt the workspace's default SOP");

    const evolutionItem = manager.createEvolutionItem({
      workspaceId: "evolution-center",
      title: "治理裁决后确认 resolved",
      content: "演进工作区必须经过治理裁决后才能进入 resolved 状态。",
      tags: ["constraint"],
    });
    const evolutionConversation = store.getConversation(evolutionItem.conversation!.id)!;
    assert.equal(evolutionConversation.owner_type, "evolution", "evolution conversation should use the evolution owner");
    assert.equal(evolutionConversation.workspace_id, "evolution-center", "evolution conversation should own evolution-center workspace");
    await manager.sendMessage(evolutionConversation.id, "开始治理这个演进工作区");
    assert.equal(store.getMessages(evolutionConversation.id)[0].id > 0, true, "evolution messages should expose conversation-local positive ids");
    assert(runtimeInputs.some((input) => input.includes("开始治理这个演进工作区")), "evolution conversation should run through the normal agent message pipeline");
    systemReminderInputs.forEach((s, i) => console.log("  [" + i + "] len=" + s.length + " hasEvolution=" + s.includes("Evolution") + " hasEvolutionItemID=" + s.includes(evolutionItem.id)));
    assert(systemReminderInputs.some((input) => input.includes("Evolution Item ID: " + evolutionItem.id) && input.includes("软件只负责提取演进候选、打开治理对话和提供回写入口")), "evolution conversation systemReminder should include evolution item context and AI-driven governance boundary");
    const updatedItem = manager.updateEvolutionItem(evolutionItem.id, { title: "演进工作区必须人工审批（已更新）" });
    assert.equal(updatedItem.title, "演进工作区必须人工审批（已更新）", "manager update should set evolution item title");

    await manager.sendMessage(created.conversation.id, "hello");
    assert(runtimeInputs.some((input) => input.includes("hello")), "designer should be invoked for design conversation");
    const designReminder = systemReminderInputs.at(-1) ?? "";
    assert(designReminder.includes("独立分析需求"), "design conversation should resolve the designer role");

    store.updateStage(created.stage.id, { output_artifacts: { issue_doc: "I2026053101 locked" } });

    const development = manager.advanceIssue(created.issue.id);
    assert.equal(development.next_stage?.type, "development", "design should advance to development");
    assert.deepEqual(development.next_stage!.input_artifacts, { issue_doc: "I2026053101 locked" }, "advance response should include development input artifacts derived from previous design output artifacts");

    await manager.sendConversationMessage(development.conversation!.id, { content: "开始实现", events: [{ kind: "text", payload: { text: "开始实现", mentions: ["研发者"] } }] });
    const developmentReminder = systemReminderInputs.at(-1) ?? "";
    assert(developmentReminder.includes("先写测试再实现"), "development conversation should resolve the development-stage 研发者 role");
    assert(!developmentReminder.includes("回应所有 comment"), "development conversation must not use the review-stage 研发者 role");

    store.updateStage(development.next_stage!.id, { output_artifacts: { pr_url: "PR #1 已合并" } });

    const review = manager.advanceIssue(created.issue.id);
    assert.equal(review.next_stage?.type, "review", "development should advance to review");
    assert.deepEqual(review.next_stage!.input_artifacts, { pr_url: "PR #1 已合并" }, "advance response should include review input artifacts derived from previous development output artifacts");

    await manager.sendConversationMessage(review.conversation!.id, { content: "请研发者回应 review", events: [{ kind: "text", payload: { text: "请研发者回应 review", mentions: ["研发者"] } }] });
    const reviewReminder = systemReminderInputs.at(-1) ?? "";
    assert(reviewReminder.includes("回应所有 comment"), "review conversation should resolve the review-stage 研发者 role");
    assert(!reviewReminder.includes("先写测试再实现"), "review conversation must not use the development-stage 研发者 role");
    assert(reviewReminder.includes("PR #1 已合并"), "review conversation prompt should include derived input artifacts from development output");

    store.updateStage(review.next_stage!.id, { output_artifacts: { review_result: "检视通过" } });

    const merge = manager.advanceIssue(created.issue.id);
    assert.equal(merge.next_stage?.type, "merge", "review should advance to merge");
    assert.deepEqual(merge.next_stage!.input_artifacts, { review_result: "检视通过" }, "merge input artifacts should derive from review output");

    store.updateStage(merge.next_stage!.id, { output_artifacts: { merge_result: "已合入" } });

    const issueComplete = manager.advanceIssue(created.issue.id);
    assert.equal(issueComplete.completed_stage.id, merge.next_stage!.id, "merge stage should be completed");
    assert.equal(issueComplete.next_stage, null, "merge completion should not auto-create another stage");

    const parallelIssue = manager.createIssue(created.workspace.id, "Parallel Issue", "test parallel work");
    assert.equal(parallelIssue.stage.type, "design", "new issue should start with design stage");

    const archivedParallelIssue = manager.archiveIssue(parallelIssue.issue.id);
    assert(archivedParallelIssue.issue.closed_at, "archiving should persist a closed timestamp");
    assert.equal(archivedParallelIssue.cleanup.steps.length, 0, "archiving with no recorded resources should produce no cleanup steps");
    assert(manager.getIssue(parallelIssue.issue.id)!.closed_at, "archived issue should remain closed from the manager");
    assert.throws(
      () => manager.completeIssue(parallelIssue.issue.id),
      /read-only/,
      "closed issue must not be overwritten by lifecycle completion"
    );
    assert.throws(
      () => manager.advanceIssue(parallelIssue.issue.id),
      /read-only/,
      "closed issue must not advance workflow"
    );
    assert.throws(
      () => manager.createConversation({ workspaceId: created.workspace.id, issueId: parallelIssue.issue.id, stageId: parallelIssue.stage.id, title: "Archived Conversation", kind: "discussion" }),
      /read-only/,
      "closed issue must not accept new conversations"
    );
    await assert.rejects(
      () => manager.sendMessage(parallelIssue.conversation.id, "after archive"),
      /read-only/,
      "closed issue conversations must reject new messages"
    );

    const bounced = manager.bounceIssueStage(created.issue.id, merge.next_stage!.id);
    assert.equal(bounced.completed_stage.id, merge.next_stage!.id, "merge stage should be bounce source");
    assert.equal(bounced.next_stage!.type, "review", "merge bounce should target review stage");
    assert.equal(bounced.next_stage!.sequence, 5, "bounce should append a fresh issue-local stage instance");
    assert.deepEqual(bounced.next_stage!.input_artifacts, { merge_result: "已合入" }, "bounce response should include review input artifacts derived from previous merge output artifacts");
    assert.equal(bounced.conversation!.default_role, "研发者", "review stage primary role is developer (responds to review comments)");
    assert.deepEqual(bounced.conversation!.from_conversation_ids, [merge.conversation!.id], "bounce should carry merge context");

    assert.throws(
      () => manager.bounceIssueStage(created.issue.id, merge.next_stage!.id),
      /does not match latest issue stage/,
      "bounce should reject stale stage ids"
    );

    const repoFeature = manager.createIssue(created.workspace.id, "Repo Context Issue", "test repo context");
	    store.updateStage(repoFeature.stage.id, {
	      output_artifacts: {
	        branch_name: "feature/repo-context-test",
	        pr_url: "https://github.com/chenlaicai/snail-shell/pull/1",
	      },
	    });
	    const updatedStage = store.getStage(repoFeature.stage.id)!;
	    assert.equal(updatedStage.output_artifacts["branch_name"], "feature/repo-context-test", "stage should record branch name for completion cleanup");
	    assert.equal(updatedStage.output_artifacts["pr_url"], "https://github.com/chenlaicai/snail-shell/pull/1", "stage should record PR URL for traceability");
    const completedRepoFeature = manager.completeIssue(repoFeature.issue.id);
    assert(completedRepoFeature.issue.closed_at, "completion endpoint should set closed timestamp");
    assert.equal(completedRepoFeature.cleanup.steps.find((step) => step.target === "worktree"), undefined, "no worktree step when worktree_path not recorded");
    assert.equal(completedRepoFeature.cleanup.steps.find((step) => step.target === "branch")?.status, "skipped", "recorded branch that doesn't exist in git should be skipped");

	    // setIssueTaskAnchor
	    const taskAnchorFeature = manager.createIssue(created.workspace.id, "Task Anchor Issue", "test task anchor");
	    assert.equal(taskAnchorFeature.issue.task_anchor, null, "new issue should have null task anchor");
	    const anchored = manager.setIssueTaskAnchor(taskAnchorFeature.issue.id, "本质目标: 测试任务锚\\n反目标: 不偏离目标\\n语义不变量: 核心约束不变\\n成功标准: 测试通过");
	    assert.equal(anchored.task_anchor, "本质目标: 测试任务锚\\n反目标: 不偏离目标\\n语义不变量: 核心约束不变\\n成功标准: 测试通过", "setIssueTaskAnchor should persist task anchor");
	    assert.equal(manager.getIssue(taskAnchorFeature.issue.id)!.task_anchor, "本质目标: 测试任务锚\\n反目标: 不偏离目标\\n语义不变量: 核心约束不变\\n成功标准: 测试通过", "db should preserve task anchor across reads");
	    manager.archiveIssue(taskAnchorFeature.issue.id);
	    assert.throws(
	      () => manager.setIssueTaskAnchor(taskAnchorFeature.issue.id, "archived"),
	      /read-only/,
	      "archived issue should reject task anchor writes"
	    );

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
  const created = manager.createWorkspace("Serialization Test", { summary: "test", workspaceRoot: process.cwd(), sopId: "sop-test", roleBindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } });
  const first = manager.sendMessage(created.conversation.id, "first");
  const second = manager.sendMessage(created.conversation.id, "second");
  await Promise.all([first, second]);
  const latestInputs = runtimeInputs.slice(-2);
  assert(latestInputs[0]?.includes("first") && !latestInputs[0]?.includes("second"), "first queued message should invoke with isolated pending input");
  assert(latestInputs[1]?.includes("second") && !latestInputs[1]?.includes("first"), "second queued message should invoke after the first without merging input");
}

function testManagerMessagePaginationContracts(): void {
  const created = manager.createWorkspace("Recent Messages Test", { summary: "test", workspaceRoot: process.cwd(), sopId: "sop-test", roleBindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } });
  const streaming = store.addMessage({ conversationId: created.conversation.id, fromRole: "Owner Snail", toRoles: [], role: "assistant", runtime: "system", status: "streaming", contextCutoffAt: "0" });
  const messageIds = Array.from({ length: 5 }, () => store.addMessage({ conversationId: created.conversation.id, fromRole: "Boss Role", toRoles: [], role: "user", runtime: "system", status: "completed", contextCutoffAt: String(store.getMessages(created.conversation.id).at(-1)?.id ?? 0) }).id);
  const firstPage = manager.getConversationMessages(created.conversation.id, 3, 0).map((message) => message.id);
  const secondPage = manager.getConversationMessages(created.conversation.id, 3, 3).map((message) => message.id);
  const recentSnapshot = manager.getRecentConversationMessages(created.conversation.id, 3);
  const recent = recentSnapshot.items.map((message) => message.id);
  assert.deepEqual(firstPage, [streaming.id, ...messageIds.slice(0, 2)], "messages endpoint should keep oldest-first pagination");
  assert.deepEqual(secondPage, messageIds.slice(2), "messages endpoint offset should continue the same oldest-first sequence");
  assert(messageIds.slice(-3).every((id) => recent.includes(id)), "recent messages endpoint should include the latest completed window in display order");
  assert(recent.includes(streaming.id), "recent messages endpoint should include active streaming messages even outside the fixed window");
  assert(Number.isInteger(recentSnapshot.last_event_id), "recent messages endpoint should expose an event cursor");

  store.addMessageEvent(streaming.id, { kind: "start", payload: { role: "assistant", role_name: "Owner Snail", runtime: "system" } });
  const beforeBackfill = manager.getLastConversationEventId(created.conversation.id);
  const backfilledEvent = store.addMessageEvent(streaming.id, buildPlainTextEvent("backfill boundary"));
  const afterBackfill = manager.getLastConversationEventId(created.conversation.id);
  assert(manager.getConversationEventsBetween(created.conversation.id, 0, afterBackfill).some((event) => event.id === backfilledEvent.id), "bounded backfill should treat cursor 0 as a valid request from the beginning of the timeline");
  assert(manager.getConversationEventsBetween(created.conversation.id, beforeBackfill, beforeBackfill).length === 0, "bounded backfill should not include events above its subscription watermark");
  assert(manager.getConversationEventsBetween(created.conversation.id, beforeBackfill, afterBackfill).some((event) => event.id === backfilledEvent.id), "bounded backfill should include events up to the subscription watermark");
}
