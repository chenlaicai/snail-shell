import assert from "assert";
import { parseKnowledgeExtractionResult } from "../../src/llm";

const parsed = parseKnowledgeExtractionResult(`说明文字 {"candidates":[{"title":"检视需具备全链路意识","content":"检视 PR 时必须关注上下游是否让能力实际生效。","rationale":"用户明确提出长期检视标准。","kind":"rule","scope_type":"snail","scope_ref":"Acceptance Snail","quote":"要有全链路意识"},{"title":"无效候选","content":"缺少类型"}]}`);

assert.equal(parsed.candidates.length, 1, "parser should keep only complete knowledge candidates");
assert.equal(parsed.candidates[0]!.kind, "rule", "parser should preserve valid knowledge kind");
assert.equal(parsed.candidates[0]!.scopeType, "snail", "parser should normalize snake_case scope_type");
assert.equal(parsed.candidates[0]!.scopeRef, "Acceptance Snail", "parser should preserve scope_ref");

const empty = parseKnowledgeExtractionResult("{\"candidates\":[]}");
assert.deepEqual(empty.candidates, [], "parser should accept an empty candidate list");

console.log("knowledge-extractor tests passed");
