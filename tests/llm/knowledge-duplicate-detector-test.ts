import assert from "assert";
import { OpenAIClient } from "../../src/llm/openai";
import { OpenAIKnowledgeDuplicateDetector } from "../../src/llm/knowledge-duplicate-detector";

class MockOpenAIClient extends OpenAIClient {
  constructor(private mockResponse: string) {
    super({ apiKey: "mock-key", model: "mock-model" });
  }

  async createChatCompletion(): Promise<string> {
    return this.mockResponse;
  }
}

async function run(): Promise<void> {
  const existing = [{
    id: "knowledge-existing",
    project_id: "project-1",
    scope_type: "project" as const,
    scope_ref: "project-1",
    kind: "rule" as const,
    status: "active" as const,
    governance_level: "L1" as const,
    title: "Snail Shell 不做移动端适配",
    content: "当前 Snail Shell 仅面向桌面端浏览器使用，不要求移动端布局适配。",
    rationale: null,
    updated_at: "2026-05-08 00:00:00",
  }];
  const candidate = {
    project_id: "project-1",
    scope_type: "project" as const,
    scope_ref: "project-1",
    kind: "rule" as const,
    title: "不用考虑手机端",
    content: "Snail Shell 的界面设计只需要覆盖桌面浏览器，不需要为移动端做响应式支持。",
    rationale: null,
  };

  const detector = new OpenAIKnowledgeDuplicateDetector(new MockOpenAIClient(JSON.stringify({ duplicate_id: "knowledge-existing", reason: "两者都表达桌面端限定，不要求移动端适配。", merged_candidate: null })));
  const duplicate = await detector.detectDuplicate({ candidate, existing });
  assert.equal(duplicate.duplicateId, "knowledge-existing", "detector should accept semantic duplicate ids even when text differs");
  assert.equal(duplicate.mergedCandidate, null, "detector should not merge active knowledge content");

  const pendingExisting = [{ ...existing[0]!, id: "knowledge-pending", status: "candidate" as const }];
  const mergeDetector = new OpenAIKnowledgeDuplicateDetector(new MockOpenAIClient(JSON.stringify({
    duplicate_id: "knowledge-pending",
    reason: "两条候选表达相同桌面端边界，新候选补充了界面设计语境。",
    merged_candidate: {
      title: "Snail Shell 不要求移动端适配",
      content: "Snail Shell 当前仅面向桌面端浏览器使用；界面设计和验证不要求覆盖移动端响应式布局。",
      rationale: "两条候选语义重复，合并后保留原有桌面端边界并补充界面设计验证范围。",
    },
  })));
  const merged = await mergeDetector.detectDuplicate({ candidate, existing: pendingExisting });
  assert.equal(merged.duplicateId, "knowledge-pending", "detector should still return the pending duplicate id");
  assert.equal(merged.mergedCandidate?.title, "Snail Shell 不要求移动端适配", "detector should parse semantic merge content for candidate duplicates");

  const invalidDetector = new OpenAIKnowledgeDuplicateDetector(new MockOpenAIClient(JSON.stringify({ duplicate_id: "outside-id", reason: "bad id" })));
  const invalid = await invalidDetector.detectDuplicate({ candidate, existing });
  assert.equal(invalid.duplicateId, null, "detector should reject ids outside the provided candidate set");
  assert.equal(invalid.mergedCandidate, null, "invalid duplicate ids must not carry merge content");

  const malformedDetector = new OpenAIKnowledgeDuplicateDetector(new MockOpenAIClient("not json"));
  const malformed = await malformedDetector.detectDuplicate({ candidate, existing });
  assert.equal(malformed.duplicateId, null, "detector should fail closed on malformed model output");

  console.log("knowledge-duplicate-detector tests passed");
}

run().catch((error) => {
  throw error;
});
