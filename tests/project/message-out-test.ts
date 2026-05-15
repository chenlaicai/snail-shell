import { execFileSync } from "child_process";
import path from "path";
import { buildMessageOutBlocks, buildMessageOutText, extractEmbeddedMessageOutCandidate, parseMessageOutPayload } from "../../src/message-bus/message-out";
import type { ContentBlockEventPayload, TextEventPayload } from "../../src/persistence/store";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const plain = buildMessageOutText({ content: "普通回复" });
assert(plain.kind === "text", "plain text should map to text event");
assert((plain.payload as TextEventPayload).text === "普通回复", "plain text content should be preserved");

const structured = buildMessageOutText({ content: "请 @Product Snail 继续", mentions: ["Product Snail"] });
assert(structured.kind === "text", "mentions text should map to text event");
assert((structured.payload as TextEventPayload).mentions[0] === "Product Snail", "mentions should be preserved");

const blocks = buildMessageOutBlocks({ blocks: [{ type: "text", text: "阶段总结" }, { type: "tool_call_card", tool_name: "search", status: "success", summary: "已完成搜索" }], fallback_text: "阶段总结\n\n已完成搜索" });
assert(blocks.kind === "content_block", "blocks payload should map to content_block event");
assert((blocks.payload as ContentBlockEventPayload).blocks.length === 2, "blocks payload should preserve blocks");

const question = parseMessageOutPayload(JSON.stringify({ format: "blocks", blocks: [{ type: "question", title: "需要你的确认", question: "请选择一个方案", selection_mode: "single", options: [{ key: "a", label: "方案 A" }] }], fallback_text: "需要你的确认\n请选择一个方案" }));
assert(question.kind === "content_block", "question should map to content_block event");
const questionBlock = (question.payload as ContentBlockEventPayload).blocks[0];
assert(questionBlock.type === "question" && questionBlock.options.length === 1, "question block should be preserved");

const response = parseMessageOutPayload(JSON.stringify({ format: "blocks", blocks: [{ type: "question_response", response_to: { title: "需要你的确认" }, selection_mode: "single", selected_options: [{ key: "a", label: "方案 A" }], summary: "选择了方案 A" }], fallback_text: "选择了方案 A" }));
assert(response.kind === "content_block", "question response should map to content_block event");
const responseBlock = (response.payload as ContentBlockEventPayload).blocks[0];
assert(responseBlock.type === "question_response" && responseBlock.summary === "选择了方案 A", "question response summary should be preserved");

const extendedBlocks = parseMessageOutPayload(JSON.stringify({ format: "blocks", fallback_text: "扩展块结果", blocks: [{ type: "markdown", text: "# 标题\n正文" }, { type: "table", title: "结果表", columns: ["Name", "Value"], rows: [["A", 1], ["B", 2]] }, { type: "artifact_card", artifact_id: "artifact-1", artifact_type: "project_charter", title: "Project Charter", summary: "项目章程摘要", status: "active" }, { type: "reference_card", ref_type: "message", ref_id: "42", title: "引用消息", summary: "引用摘要" }] }));
assert(extendedBlocks.kind === "content_block" && (extendedBlocks.payload as ContentBlockEventPayload).blocks.length === 4, "parser should accept extended block payloads");

const embeddedCandidate = extractEmbeddedMessageOutCandidate("先说明上下文。 {\"format\":\"blocks\",\"blocks\":[{\"type\":\"text\",\"text\":\"最终结论\"}],\"fallback_text\":\"最终结论\"}");
assert(typeof embeddedCandidate === "string" && embeddedCandidate.includes('"format":"blocks"'), "should extract trailing embedded message-out payload from mixed reply text");

const cliPath = path.join(process.cwd(), ".meta", "skills", "message-out", "message-out.js");
const cliQuestion = execFileSync("node", [cliPath, "question", "--title", "需要你的确认", "--question", "请选择一个方案", "--options", JSON.stringify([{ key: "a", label: "方案 A" }])], { encoding: "utf8" });
const cliQuestionEvent = JSON.parse(cliQuestion);
assert(cliQuestionEvent.format === "blocks", "message-out CLI should output canonical blocks payload");
assert(cliQuestionEvent.blocks[0].type === "question", "message-out question command should output content_block payload body");
const reparsedCliQuestion = parseMessageOutPayload(cliQuestion);
assert(reparsedCliQuestion.kind === "content_block", "message-out CLI output should be accepted by parser");

const cliText = execFileSync("node", [cliPath, "text"], { encoding: "utf8", input: "已处理 `renderTargetOptions`。" });
const cliTextEvent = JSON.parse(cliText);
assert(cliTextEvent.blocks[0].type === "text", "message-out text command should accept plain stdin text");
assert(cliTextEvent.blocks[0].text === "已处理 `renderTargetOptions`。", "plain stdin text should preserve markdown backticks");
assert(parseMessageOutPayload(cliText).kind === "content_block", "plain stdin text output should be accepted by parser");

const cliMentionText = execFileSync("node", [cliPath, "text", "--text", "已提交检视意见，请处理。", "--mentions", "研发者"], { encoding: "utf8" });
const cliMentionTextEvent = JSON.parse(cliMentionText);
assert(cliMentionTextEvent.blocks[0].mentions[0] === "研发者", "message-out text command should preserve explicit mentions");
assert(parseMessageOutPayload(cliMentionText).kind === "content_block", "mentioned text output should be accepted by parser");

// 边界条件测试：无效 JSON 参数
try {
  execFileSync("node", [cliPath, "question", "--title", "测试", "--question", "问题", "--options", "not-json"], { encoding: "utf8" });
  throw new Error("should have thrown for invalid JSON");
} catch (error) {
  assert(error instanceof Error && error.message.includes("Invalid JSON for options"), "invalid JSON should produce clear error message");
}

// 边界条件测试：缺少必填参数
try {
  execFileSync("node", [cliPath, "question", "--title", "测试"], { encoding: "utf8" });
  throw new Error("should have thrown for missing required arg");
} catch (error) {
  assert(error instanceof Error && error.message.includes("requires --question parameter"), "missing required arg should produce clear error message");
}

// 边界条件测试：缺少多个必填参数时，提示第一个缺失的参数
try {
  execFileSync("node", [cliPath, "question"], { encoding: "utf8" });
  throw new Error("should have thrown for missing required args");
} catch (error) {
  assert(error instanceof Error && error.message.includes("requires --title parameter"), "missing first required arg should be reported first");
}

console.log("message-out tests passed");
