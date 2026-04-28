import assert from "assert";
import fs from "fs";
import path from "path";
import { ProjectManager } from "../../src/project/manager";
import { ConversationStore } from "../../src/persistence/store";
import { SnailRegistry } from "../../src/snails";
import type { AgentRuntime, SnailRuntimeMessageInput } from "../../src/agent/interface";
import type { SnailDefinition } from "../../src/snails";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-stage-cycle.db");

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
const manager = new ProjectManager(
  store,
  {
    resolve(snail: SnailDefinition) {
      runtimeCalls.push(snail.runtime);
      return {
        name: snail.runtime,
        runtime: snail.runtime,
        invokeMessage: async (input: SnailRuntimeMessageInput) => ({ content: `handled by ${input.snail.runtime}` }),
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
    assert(runtimeCalls.includes("codex-cli"), "implementation snail should use codex runtime");

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
      /does not match active review stage/,
      "restart should reject stale review stage ids"
    );

    const freshDevelopment = manager.restartDevelopmentCycle(created.project.id, secondReview.next_stage.id);
    assert.equal(freshDevelopment.completed_stage.id, secondReview.next_stage.id, "review stage should be completed without formal artifacts");
    assert.equal(freshDevelopment.next_stage.type, "development", "restart should create a new development stage");
    assert.equal(freshDevelopment.next_stage.sequence, 5, "restart should append a fresh stage instance");
    assert.equal(freshDevelopment.conversation.default_snail, "Implementation Snail", "fresh development cycle should use implementation snail");
    assert.deepEqual(freshDevelopment.conversation.from_conversation_ids, [], "fresh development cycle should not carry prior conversations");
  } finally {
    store.close();
    removeDbFiles(TEST_DB);
  }

  console.log("stage-cycle tests passed");
}
