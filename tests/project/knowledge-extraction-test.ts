import assert from "assert";
import fs from "fs";
import path from "path";
import type { AgentEvent, SnailRuntimeMessageInput } from "../../src/agent/interface";
import type { KnowledgeExtractionInput, KnowledgeExtractionResult } from "../../src/llm";
import { ProjectManager } from "../../src/project/manager";
import { ConversationStore } from "../../src/persistence/store";
import { SnailRegistry } from "../../src/snails";
import type { AgentSnailDefinition } from "../../src/snails";

const TEST_DB = path.join(__dirname, "..", "..", "data", "test-knowledge-extraction.db");

function removeDbFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
removeDbFiles(TEST_DB);

const store = new ConversationStore(TEST_DB);
const snailRegistry = new SnailRegistry();
const extractionInputs: KnowledgeExtractionInput[] = [];

const manager = new ProjectManager(
  store,
  {
    resolve(snail: AgentSnailDefinition) {
      return {
        name: snail.runtime,
        runtime: snail.runtime,
        invokeMessage: async (_input: SnailRuntimeMessageInput, onEvent: (event: AgentEvent) => void) => {
          onEvent({ type: "message_event", event: { kind: "text", payload: { text: "收到，会按全链路意识检视上下游。", mentions: [] } } });
          return {};
        },
      };
    },
    list: () => [],
  },
  snailRegistry,
  { generateConversationSummary: async () => "summary", generateMessageContextSummary: async (input) => input.context.slice(0, input.targetChars) },
  { extractMentions: async () => ({ mentions: [] }) },
  {
    extractKnowledge: async (input) => {
      extractionInputs.push(input);
      if (!input.message.content.includes("全链路意识")) return { candidates: [] };
      return buildKnowledgeResult(input);
    },
  }
);

run().catch((error) => {
  throw error;
});

async function run(): Promise<void> {
  try {
    const created = manager.createProject("Knowledge Extraction Test", "test", "system_self");
    const sendResult = await manager.sendMessage(created.conversation.id, "@Acceptance Snail 要有全链路意识！虽然本次pr内容是增加清理能力，但这个能力的上下游也是你要检视的关注点啊。");
    const userMessageId = sendResult.messageIds[0]!;

    assert(extractionInputs.some((input) => input.message.fromSnail === "Boss Snail"), "user messages should enter the knowledge extraction side path");
    const candidates = manager.listKnowledge({ projectId: created.project.id, status: "candidate" });
    const persisted = candidates.map((candidate) => manager.getKnowledge(candidate.id)!).find((candidate) => candidate.sources.some((source) => source.source_id === String(userMessageId)));
    assert(persisted, "extractor output should be persisted as a candidate knowledge item sourced from the user message");
    assert.equal(persisted.scope_type, "snail", "role-specific review guidance should keep its snail scope");

    assert.equal(persisted.sources[0]!.source_type, "message", "candidate knowledge should keep source traceability");
    assert(persisted.sources[0]!.quote?.includes("全链路意识"), "candidate source should quote the triggering message");
  } finally {
    store.close();
    removeDbFiles(TEST_DB);
  }

  console.log("knowledge-extraction tests passed");
}

function buildKnowledgeResult(input: KnowledgeExtractionInput): KnowledgeExtractionResult {
  return {
    candidates: [
      {
        title: "检视需具备全链路意识",
        content: "Acceptance Snail 检视 PR 时不能只看本次改动本身，还必须关注能力上下游是否已具备，否则可能放通无法实际生效的 PR。",
        rationale: "用户明确纠偏检视职责边界，具备后续复用价值。",
        kind: "rule",
        scopeType: "snail",
        scopeRef: "Acceptance Snail",
        quote: input.message.content,
      },
    ],
  };
}
