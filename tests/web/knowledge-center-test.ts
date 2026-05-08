import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const knowledgeCenter = fs.readFileSync(path.resolve(__dirname, "../../src/web/knowledge-center.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");

assert(knowledgeCenter.includes("系统提示词反哺配置"), "knowledge center should expose real prompt feedback policy editing UI");
assert(knowledgeCenter.includes("knowledge-directory-summary"), "knowledge center summary should live in the left directory column");
assert(knowledgeCenter.includes("knowledge-directory-row"), "knowledge center should render knowledge entries as left directory rows");
assert(knowledgeCenter.includes("当前真实接入运行时的 prompt 注入"), "knowledge center should distinguish real prompt runtime from static carrier work");
assert(knowledgeCenter.includes("需要通过静态产物或运行时注册单独落地"), "knowledge center should explain static carriers instead of pretending they are configured here");
assert(knowledgeCenter.includes("知识内容") && knowledgeCenter.includes("真正要被长期记住和复用"), "knowledge center should explain what the knowledge content field means");
assert(knowledgeCenter.includes("Prompt 模式怎么选"), "knowledge center should explain prompt mode choices in user-facing language");
assert(knowledgeCenter.includes("不注入：保存知识，但不自动放进系统提示词"), "knowledge center should explain none prompt mode");
assert(knowledgeCenter.includes("摘要：只提醒结论，适合长决策"), "knowledge center should explain summary prompt mode");
assert(knowledgeCenter.includes("完整内容：逐字给 agent 看"), "knowledge center should explain full prompt mode");
assert(knowledgeCenter.includes("参考提醒：告诉 agent 需要参考这条知识"), "knowledge center should explain reference-only prompt mode");
assert(knowledgeCenter.includes("留空 = 所有阶段都可用"), "knowledge center should tell users how to fill stage constraints");
assert(knowledgeCenter.includes("留空 = 所有 Snail 都可用"), "knowledge center should tell users how to fill snail constraints");
assert(knowledgeCenter.includes("项目/Feature 规则通常用 20"), "knowledge center should tell users how to choose priority");
assert(!knowledgeCenter.includes("Skill 可见性"), "knowledge center must not expose fake skill runtime policy configuration");
assert(!knowledgeCenter.includes("MCP/tool 可见性"), "knowledge center must not expose fake MCP/tool runtime policy configuration");
assert(!knowledgeCenter.includes("Checker 绑定"), "knowledge center must not expose fake checker runtime policy configuration");
assert(knowledgeCenter.includes('api("PUT", `/knowledge/${state.selected.id}/usage-policy`'), "knowledge center should save policy through the usage-policy API");
assert(knowledgeCenter.includes("splitList(field("), "knowledge center should normalize list policy fields before saving");
assert(styles.includes(".knowledge-policy-grid"), "knowledge policy form should have dedicated responsive layout styles");
assert(styles.includes(".knowledge-field-grid"), "knowledge detail should use field cards for readable explanations");
assert(styles.includes(".knowledge-mode-guide"), "knowledge policy form should style prompt mode explanations");
assert(styles.includes(".knowledge-detail") && styles.includes("overflow: auto"), "knowledge detail should have an independent scrollbar");
assert(styles.includes(".knowledge-directory-list"), "knowledge directory should have dedicated list styles in the sidebar");

console.log("knowledge-center tests passed");
