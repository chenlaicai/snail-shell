import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const knowledgeCenter = fs.readFileSync(path.resolve(__dirname, "../../src/web/knowledge-center.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");

assert(knowledgeCenter.includes("反哺策略配置"), "knowledge center should expose usage policy editing UI");
assert(knowledgeCenter.includes("系统提示词已接入运行时"), "knowledge center should distinguish prompt runtime from reserved carriers");
assert(knowledgeCenter.includes("Skill 可见性"), "knowledge center should expose skill carrier policy");
assert(knowledgeCenter.includes("MCP/tool 可见性"), "knowledge center should expose MCP/tool carrier policy");
assert(knowledgeCenter.includes("Checker 绑定"), "knowledge center should expose checker carrier policy");
assert(knowledgeCenter.includes('api("PUT", `/knowledge/${state.selected.id}/usage-policy`'), "knowledge center should save policy through the usage-policy API");
assert(knowledgeCenter.includes("splitList(field("), "knowledge center should normalize list policy fields before saving");
assert(styles.includes(".knowledge-policy-grid"), "knowledge policy form should have dedicated responsive layout styles");

console.log("knowledge-center tests passed");
