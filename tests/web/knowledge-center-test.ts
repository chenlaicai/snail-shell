import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const knowledgeCenter = fs.readFileSync(path.resolve(__dirname, "../../src/web/knowledge-center.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");

assert(knowledgeCenter.includes("系统提示词反哺配置"), "knowledge center should expose real prompt feedback policy editing UI");
assert(knowledgeCenter.includes("当前真实接入运行时的 prompt 注入"), "knowledge center should distinguish real prompt runtime from static carrier work");
assert(knowledgeCenter.includes("需要通过静态产物或运行时注册单独落地"), "knowledge center should explain static carriers instead of pretending they are configured here");
assert(!knowledgeCenter.includes("Skill 可见性"), "knowledge center must not expose fake skill runtime policy configuration");
assert(!knowledgeCenter.includes("MCP/tool 可见性"), "knowledge center must not expose fake MCP/tool runtime policy configuration");
assert(!knowledgeCenter.includes("Checker 绑定"), "knowledge center must not expose fake checker runtime policy configuration");
assert(knowledgeCenter.includes('api("PUT", `/knowledge/${state.selected.id}/usage-policy`'), "knowledge center should save policy through the usage-policy API");
assert(knowledgeCenter.includes("splitList(field("), "knowledge center should normalize list policy fields before saving");
assert(styles.includes(".knowledge-policy-grid"), "knowledge policy form should have dedicated responsive layout styles");

console.log("knowledge-center tests passed");
