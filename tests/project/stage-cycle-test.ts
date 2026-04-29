import assert from "assert";
import fs from "fs";
import path from "path";
import { ProjectManager } from "../../src/project/manager";
import { ConversationStore } from "../../src/persistence/store";
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
  { generateConversationSummary: async () => "summary" },
  { extractMentions: async () => ({ mentions: [] }) }
);

run().catch((error) => {
  throw error;
});

async function run(): Promise<void> {
  try {
    const created = manager.createProject("Stage Cycle Test", "test", "system_self");
    assert.equal(created.conversation.default_snail, "Implementation Snail", "development should start with implementation snail");

    await manager.sendMessage(created.conversation.id, "hello");
    assert(runtimeCalls.includes("opencode-cli"), "implementation snail should use opencode runtime");

    const developmentArtifact = manager.createArtifact(created.conversation.id, "pull_request_record", "PR", {
      status: "active",
      options: { inlineContent: "PR ready" },
    });
    manager.setStageFormalArtifacts(created.stage.id, [developmentArtifact.id]);

    const review = manager.completeStageAndAdvance(created.project.id);
    assert.equal(review.next_stage.type, "review", "development should advance to review");

    const reviewArtifact = manager.createArtifact(review.conversation.id, "review_completion_record", "Review", {
      status: "active",
      options: { inlineContent: "No pending issues" },
    });
    manager.setStageFormalArtifacts(review.next_stage.id, [reviewArtifact.id]);

    const nextCycle = manager.completeStageAndAdvance(created.project.id);
    assert.equal(nextCycle.completed_stage.id, review.next_stage.id, "review stage should be completed");
    assert.equal(nextCycle.next_stage.type, "development", "review should cycle back to a new development stage");
    assert.equal(nextCycle.next_stage.sequence, 3, "new cycle should append a fresh stage instance");
    assert.equal(nextCycle.conversation.default_snail, "Implementation Snail", "new development cycle should use implementation snail");

    const secondDevelopmentArtifact = manager.createArtifact(nextCycle.conversation.id, "pull_request_record", "PR 2", {
      status: "active",
      options: { inlineContent: "PR ready again" },
    });
    manager.setStageFormalArtifacts(nextCycle.next_stage.id, [secondDevelopmentArtifact.id]);

    const secondReview = manager.completeStageAndAdvance(created.project.id);
    assert.equal(secondReview.next_stage.type, "review", "second development should advance to review");

    assert.throws(
      () => manager.restartDevelopmentCycle(created.project.id, review.next_stage.id),
      /does not match active stage/,
      "restart should reject stale stage ids"
    );

    const freshDevelopment = manager.restartDevelopmentCycle(created.project.id, secondReview.next_stage.id);
    assert.equal(freshDevelopment.completed_stage.id, secondReview.next_stage.id, "review stage should be completed without formal artifacts");
    assert.equal(freshDevelopment.next_stage.type, "development", "restart should create a new development stage");
    assert.equal(freshDevelopment.next_stage.sequence, 5, "restart should append a fresh stage instance");
    assert.equal(freshDevelopment.conversation.default_snail, "Implementation Snail", "fresh development cycle should use implementation snail");
    assert.deepEqual(freshDevelopment.conversation.from_conversation_ids, [], "fresh development cycle should not carry prior conversations");

    const restartedDevelopment = manager.restartDevelopmentCycle(created.project.id, freshDevelopment.next_stage.id);
    assert.equal(restartedDevelopment.completed_stage.id, freshDevelopment.next_stage.id, "development stage should be restartable");
    assert.equal(restartedDevelopment.next_stage.type, "development", "restart from development should create a new development stage");

    await testManagerSerializesConversationMessages();
    testManagerLoadsRecentMessagesByDefault();
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
  assert.deepEqual(runtimeInputs.slice(-2), ["Boss Snail:\nfirst", "Boss Snail:\nsecond"], "messages in one conversation should invoke runtimes serially with isolated pending input");
}

function testManagerLoadsRecentMessagesByDefault(): void {
  const created = manager.createProject("Recent Messages Test", "test", "system_self");
  const messageIds = Array.from({ length: 5 }, (_, index) => store.addMessage({ conversationId: created.conversation.id, fromSnail: "Boss Snail", toSnails: [], role: "user", runtime: "system", status: "completed", contextCutoffAt: new Date(Date.now() + index).toISOString() }).id);
  const recent = manager.getConversationMessages(created.conversation.id, 3).map((message) => message.id);
  assert.deepEqual(recent, messageIds.slice(-3), "default conversation message load should return the latest window in display order");
}
