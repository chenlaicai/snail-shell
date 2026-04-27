import { execFileSync } from "child_process";
import path from "path";
import {
  buildMessageOutBlocks,
  buildMessageOutText,
  extractEmbeddedMessageOutCandidate,
  parseMessageOutPayload,
} from "../../src/project/message-out";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const plain = buildMessageOutText({ content: "普通回复" });
assert(plain.payload.format === "blocks", "plain text should map to blocks");
if (plain.payload.format !== "blocks") {
  throw new Error("plain text should become blocks");
}
assert(plain.payload.fallback_text === "普通回复", "plain text content should be preserved");

const structured = buildMessageOutText({ content: "请 @Product Snail 继续", mentions: ["Product Snail"] });
assert(structured.payload.format === "blocks", "mentions text should map to blocks");
if (structured.payload.format !== "blocks") {
  throw new Error("mentions text should become blocks");
}
assert(structured.payload.blocks[0].type === "text" && Array.isArray(structured.payload.blocks[0].mentions) && structured.payload.blocks[0].mentions[0] === "Product Snail", "mentions should be preserved");

const blocks = buildMessageOutBlocks({
  blocks: [
    { type: "text", text: "阶段总结" },
    { type: "tool_call_card", tool_name: "search", status: "success", summary: "已完成搜索" },
  ],
  fallback_text: "阶段总结\n\n已完成搜索",
});
assert(blocks.payload.format === "blocks", "blocks payload should map to blocks format");
if (blocks.payload.format !== "blocks") {
  throw new Error("blocks payload should remain blocks");
}
assert(blocks.payload.blocks.length === 2, "blocks payload should preserve blocks");

const question = parseMessageOutPayload(JSON.stringify({
  format: "blocks",
  blocks: [{
    type: "question",
    title: "需要你的确认",
    question: "请选择一个方案",
    selection_mode: "single",
    options: [{ key: "a", label: "方案 A" }],
  }],
  fallback_text: "需要你的确认\n请选择一个方案",
}));
assert(question.payload.format === "blocks", "question should map to blocks payload");
assert(question.payload.blocks[0].type === "question" && question.payload.blocks[0].options.length === 1, "question block should be preserved");

const response = parseMessageOutPayload(JSON.stringify({
  format: "blocks",
  blocks: [{
    type: "question_response",
    response_to: { title: "需要你的确认" },
    selection_mode: "single",
    selected_options: [{ key: "a", label: "方案 A" }],
    summary: "选择了方案 A",
  }],
  fallback_text: "选择了方案 A",
}));
assert(response.payload.format === "blocks", "question response should map to blocks payload");
assert(response.payload.blocks[0].type === "question_response" && response.payload.blocks[0].summary === "选择了方案 A", "question response summary should be preserved");

const parsed = parseMessageOutPayload(JSON.stringify({
  format: "blocks",
  blocks: [{ type: "text", text: "请 @Design Snail 继续", mentions: ["Design Snail"] }],
  fallback_text: "请 @Design Snail 继续",
}));
assert(parsed.payload.format === "blocks", "parser should accept blocks payload");

const parsedBlocks = parseMessageOutPayload(JSON.stringify({
  format: "blocks",
  fallback_text: "图片结果",
  blocks: [
    { type: "text", text: "图片结果" },
    { type: "image", url: "https://example.com/image.png", alt: "示意图" },
  ],
}));
assert(parsedBlocks.payload.format === "blocks", "parser should accept blocks payload");

const extendedBlocks = parseMessageOutPayload(JSON.stringify({
  format: "blocks",
  fallback_text: "扩展块结果",
  blocks: [
    { type: "markdown", text: "# 标题\n正文" },
    { type: "table", title: "结果表", columns: ["Name", "Value"], rows: [["A", 1], ["B", 2]] },
    { type: "artifact_card", artifact_id: "artifact-1", artifact_type: "project_charter", title: "Project Charter", summary: "项目章程摘要", status: "active" },
    { type: "reference_card", ref_type: "message", ref_id: "42", title: "引用消息", summary: "引用摘要" },
  ],
}));
assert(extendedBlocks.payload.format === "blocks" && extendedBlocks.payload.blocks.length === 4, "parser should accept extended block payloads");

const embeddedCandidate = extractEmbeddedMessageOutCandidate("先说明上下文。 {\"format\":\"blocks\",\"blocks\":[{\"type\":\"text\",\"text\":\"最终结论\"}],\"fallback_text\":\"最终结论\"}");
assert(typeof embeddedCandidate === "string" && embeddedCandidate.includes('"format":"blocks"'), "should extract trailing embedded message-out payload from mixed reply text");

const laterEmbeddedCandidate = extractEmbeddedMessageOutCandidate([
  "先给你中间结果：",
  '{"debug":true}',
  "最终请渲染这个：",
  '{"format":"blocks","blocks":[{"type":"text","text":"最终结论"}],"fallback_text":"最终结论"}',
].join("\n"));
assert(laterEmbeddedCandidate === '{"format":"blocks","blocks":[{"type":"text","text":"最终结论"}],"fallback_text":"最终结论"}', "should skip non-message-out JSON objects and return the later blocks payload");

const cliPath = path.join(process.cwd(), "dist", "src", "bin", "message-out.js");
const cliText = execFileSync("node", [cliPath, "text", "--payload", JSON.stringify({ text: "脚本普通回复" })], { encoding: "utf8" });
const cliTextPayload = JSON.parse(cliText);
assert(cliTextPayload.format === "blocks" && cliTextPayload.fallback_text === "脚本普通回复", "message-out text command should output text blocks payload");

const cliStructured = execFileSync("node", [cliPath, "text", "--payload", JSON.stringify({ text: "请 @Product Snail 继续", mentions: ["Product Snail"] })], { encoding: "utf8" });
const cliStructuredPayload = JSON.parse(cliStructured);
assert(cliStructuredPayload.format === "blocks" && cliStructuredPayload.blocks[0].mentions[0] === "Product Snail", "message-out text command should output mention text block payload");

const cliBlocks = execFileSync("node", [cliPath, "blocks", "--payload", JSON.stringify({ format: "blocks", fallback_text: "图表摘要", blocks: [{ type: "chart", chart_type: "bar", title: "燃尽图", data: { labels: ["A"], values: [1] } }] })], { encoding: "utf8" });
const cliBlocksPayload = JSON.parse(cliBlocks);
assert(cliBlocksPayload.format === "blocks" && cliBlocksPayload.blocks.length === 1, "message-out blocks command should output blocks payload");

const cliQuestion = execFileSync("node", [cliPath, "question", "--payload", JSON.stringify({ title: "需要你的确认", question: "请选择一个方案", selection_mode: "single", options: [{ key: "a", label: "方案 A" }] })], { encoding: "utf8" });
const cliQuestionPayload = JSON.parse(cliQuestion);
assert(cliQuestionPayload.format === "blocks" && cliQuestionPayload.blocks[0].type === "question", "message-out question command should output question block payload");

const cliResponse = execFileSync("node", [cliPath, "question-response", "--payload", JSON.stringify({ response_to: { title: "需要你的确认" }, selection_mode: "single", selected_options: [{ key: "a", label: "方案 A" }], summary: "选择了方案 A" })], { encoding: "utf8" });
const cliResponsePayload = JSON.parse(cliResponse);
assert(cliResponsePayload.format === "blocks" && cliResponsePayload.blocks[0].type === "question_response", "message-out question-response command should output question_response block payload");

const cliMarkdown = execFileSync("node", [cliPath, "markdown", "--payload", JSON.stringify({ text: "# 标题\n正文" })], { encoding: "utf8" });
const cliMarkdownPayload = JSON.parse(cliMarkdown);
assert(cliMarkdownPayload.format === "blocks" && cliMarkdownPayload.blocks[0].type === "markdown", "message-out markdown command should output markdown block payload");

const cliTable = execFileSync("node", [cliPath, "table", "--payload", JSON.stringify({ title: "结果表", columns: ["Name", "Value"], rows: [["A", 1], ["B", 2]] })], { encoding: "utf8" });
const cliTablePayload = JSON.parse(cliTable);
assert(cliTablePayload.format === "blocks" && cliTablePayload.blocks[0].type === "table", "message-out table command should output table block payload");

const cliArtifact = execFileSync("node", [cliPath, "artifact-card", "--payload", JSON.stringify({ artifact_id: "artifact-1", artifact_type: "project_charter", title: "Project Charter", summary: "项目章程摘要", status: "active" })], { encoding: "utf8" });
const cliArtifactPayload = JSON.parse(cliArtifact);
assert(cliArtifactPayload.format === "blocks" && cliArtifactPayload.blocks[0].type === "artifact_card", "message-out artifact-card command should output artifact_card block payload");

const cliReference = execFileSync("node", [cliPath, "reference-card", "--payload", JSON.stringify({ ref_type: "message", ref_id: "42", title: "引用消息", summary: "引用摘要", href: "https://example.com" })], { encoding: "utf8" });
const cliReferencePayload = JSON.parse(cliReference);
assert(cliReferencePayload.format === "blocks" && cliReferencePayload.blocks[0].type === "reference_card", "message-out reference-card command should output reference_card block payload");

console.log("message-out tests passed");
