import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const knowledgeCenter = fs.readFileSync(path.resolve(__dirname, "../../src/web/knowledge-center.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "../../src/web/styles.css"), "utf8");

assert(knowledgeCenter.includes("knowledge-directory-summary"), "knowledge center summary should live in the left directory column");
assert(knowledgeCenter.includes("knowledge-directory-row"), "knowledge center should render knowledge entries as left directory rows");
assert(knowledgeCenter.includes("治理进度与裁决去向"), "knowledge center should show governance progress and final disposition");
assert(knowledgeCenter.includes("选择一条知识查看来源、治理对话和裁决去向"), "knowledge detail empty state should describe governance workflow");
assert(knowledgeCenter.includes("知识本体已确认为 active"), "knowledge actions should describe active as knowledge confirmation instead of approval");
assert(knowledgeCenter.includes("确认知识本体为 active"), "candidate action should describe confirming the knowledge entity");
assert(knowledgeCenter.includes("知识本体状态"), "knowledge field guide should separate entity status from governance outcome");
assert(knowledgeCenter.includes("active 只表示知识本体成立"), "knowledge status help should explain active status");
assert(knowledgeCenter.includes("知识内容") && knowledgeCenter.includes("真正要被长期记住和复用"), "knowledge center should explain what the knowledge content field means");
assert(knowledgeCenter.includes("describeScope(item.scope_type, item.scope_ref)"), "knowledge detail header should render readable scope labels instead of raw scope pairs");
assert(knowledgeCenter.includes("describeKind(item.kind), describeStatus(item.status), describeGovernanceLevel(item.governance_level)"), "knowledge detail header should render readable classification labels");
assert(knowledgeCenter.includes("describeGovernanceDisposition(item.governance?.disposition_status)"), "knowledge list should render governance disposition status");
assert(!knowledgeCenter.includes("Skill 可见性"), "knowledge center must not expose fake skill runtime policy configuration");
assert(!knowledgeCenter.includes("MCP/tool 可见性"), "knowledge center must not expose fake MCP/tool runtime policy configuration");
assert(!knowledgeCenter.includes("Checker 绑定"), "knowledge center must not expose fake checker runtime policy configuration");
assert(!knowledgeCenter.includes("查看详情和审批操作"), "knowledge center must not keep the old approval-focused empty state");
assert(!knowledgeCenter.includes("知识已批准"), "knowledge center must not describe candidate handling as approval success");
assert(!knowledgeCenter.includes("usage-policy"), "knowledge center should not reference removed usage-policy API");
assert(!knowledgeCenter.includes("反哺"), "knowledge center should not reference removed 反哺 concept");
assert(styles.includes(".knowledge-field-grid"), "knowledge detail should use field cards for readable explanations");
assert(styles.includes(".knowledge-detail") && styles.includes("overflow: auto"), "knowledge detail should have an independent scrollbar");
assert(styles.includes(".knowledge-directory-list"), "knowledge directory should have dedicated list styles in the sidebar");

console.log("knowledge-center tests passed");
