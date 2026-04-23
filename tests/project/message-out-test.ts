import { execFileSync } from "child_process";
import path from "path";
import {
  buildMessageOutQuestion,
  buildMessageOutQuestionResponse,
  buildMessageOutText,
  parseMessageOutPayload,
} from "../../src/project/message-out";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const plain = buildMessageOutText({ content: "普通回复" });
assert(plain.payload.format === "plain_text", "plain text should map to plain_text");
if (plain.payload.format !== "plain_text") {
  throw new Error("plain text should remain plain_text");
}
assert(plain.payload.content === "普通回复", "plain text content should be preserved");

const structured = buildMessageOutText({ content: "请 @Product Snail 继续", mentions: ["Product Snail"] });
assert(structured.payload.format === "structured_text", "mentions text should map to structured_text");
if (structured.payload.format !== "structured_text") {
  throw new Error("mentions text should become structured_text");
}
assert(Array.isArray(structured.payload.mentions) && structured.payload.mentions[0] === "Product Snail", "mentions should be preserved");

const question = buildMessageOutQuestion({
  title: "需要你的确认",
  question: "请选择一个方案",
  selection_mode: "single",
  options: [{ key: "a", label: "方案 A" }],
});
assert(question.payload.format === "question", "question should map to question payload");
assert(question.payload.options.length === 1, "question options should be preserved");

const response = buildMessageOutQuestionResponse({
  response_to: { title: "需要你的确认" },
  selection_mode: "single",
  selected_options: [{ key: "a", label: "方案 A" }],
  summary: "选择了方案 A",
});
assert(response.payload.format === "question_response", "question response should map to question_response payload");
assert(response.payload.summary === "选择了方案 A", "question response summary should be preserved");

const parsed = parseMessageOutPayload(JSON.stringify({
  format: "structured_text",
  content: "请 @Design Snail 继续",
  mentions: ["Design Snail"],
}));
assert(parsed.payload.format === "structured_text", "parser should accept structured_text payload");

const cliPath = path.join(process.cwd(), "dist", "src", "bin", "message-out.js");
const cliText = execFileSync("node", [cliPath, "text", "--payload", JSON.stringify({ format: "plain_text", content: "脚本普通回复" })], { encoding: "utf8" });
const cliTextPayload = JSON.parse(cliText);
assert(cliTextPayload.format === "plain_text" && cliTextPayload.content === "脚本普通回复", "message-out text command should output plain_text payload");

const cliStructured = execFileSync("node", [cliPath, "text", "--payload", JSON.stringify({ format: "structured_text", content: "请 @Product Snail 继续", mentions: ["Product Snail"] })], { encoding: "utf8" });
const cliStructuredPayload = JSON.parse(cliStructured);
assert(cliStructuredPayload.format === "structured_text" && cliStructuredPayload.mentions[0] === "Product Snail", "message-out text command should output structured_text payload");

const cliQuestion = execFileSync("node", [cliPath, "question", "--payload", JSON.stringify({ format: "question", title: "需要你的确认", question: "请选择一个方案", selection_mode: "single", options: [{ key: "a", label: "方案 A" }] })], { encoding: "utf8" });
const cliQuestionPayload = JSON.parse(cliQuestion);
assert(cliQuestionPayload.format === "question" && cliQuestionPayload.options.length === 1, "message-out question command should output question payload");

const cliResponse = execFileSync("node", [cliPath, "question-response", "--payload", JSON.stringify({ format: "question_response", response_to: { title: "需要你的确认" }, selection_mode: "single", selected_options: [{ key: "a", label: "方案 A" }], summary: "选择了方案 A" })], { encoding: "utf8" });
const cliResponsePayload = JSON.parse(cliResponse);
assert(cliResponsePayload.format === "question_response" && cliResponsePayload.summary === "选择了方案 A", "message-out question-response command should output question_response payload");

console.log("message-out tests passed");
