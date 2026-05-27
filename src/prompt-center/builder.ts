import path from "path";
import { assembleSystemPrompt, renderPromptTemplate, listPrompts, loadProjectPrompts, mergePrompts, type PromptMatchContext, type PromptDocument } from "./registry";
import { PLATFORM_META } from "../shared/platform-paths";
import type { Conversation, Feature, KnowledgeGovernance, KnowledgeWithDetails, Project, ProjectStageDefinition, StageRoleDefinition, StageType } from "../shared/types";
import type { AgentRuntime } from "../shared/types";
import type { RoleDefinition } from "../roles";
import { collectActiveSkills } from "../agent/capability";
import type { AgentCapability } from "../agent/capability";
import type { KnowledgeLibraryKindSummary } from "../shared/knowledge-library-types";
import { resolveGuardProfile } from "../agent/guard-config";

export interface PromptBuildContext {
  project: Project;
  feature: Feature;
  stage: { id: string; feature_id: string; type: StageType; output_artifacts: Record<string, string>; input_artifacts?: Record<string, string> };
  conversation: Conversation;
  stageDefinition: ProjectStageDefinition;
  roleDefinitions: StageRoleDefinition[];
  activeRole?: RoleDefinition;
  defaultRole?: RoleDefinition;
  participatingRoles: RoleDefinition[];
  runtime?: AgentRuntime;
  knowledgeGovernanceContext?: { governance: KnowledgeGovernance; knowledge: KnowledgeWithDetails };
  remainingCollaborationRounds?: number;
  mentionAllowed?: boolean;
  forcedWrapUp?: boolean;
  knowledgeLibrarySummaries?: KnowledgeLibraryKindSummary[];
}

export function buildConversationSystemPrompt(context: PromptBuildContext): { systemPrompt: string; capability: AgentCapability } {
  const capability = buildConversationCapability(context);
  return { systemPrompt: capability.systemPrompt, capability };
}

export function buildConversationCapability(context: PromptBuildContext): AgentCapability {
  const variables = buildTemplateVariables(context);
  const matchContext: PromptMatchContext = {
    runtime: context.runtime,
    stageType: context.stage.type as StageType,
    roleName: context.activeRole?.name,
    conversationKind: context.conversation.kind,
    ownerType: context.conversation.owner_type,
  };

  const projectPrompts = loadProjectPrompts(context.project.project_root);
  const allPrompts = mergePrompts(listPrompts(), projectPrompts);

  // Exclude standalone task prompts (used directly by summary/mention tools)
  const assemblyPrompts = allPrompts.filter((p) => p.id !== "S-05" && p.id !== "S-06");

  const result = assembleSystemPrompt({
    prompts: assemblyPrompts,
    matchContext,
    variables,
  });
  const systemPrompt = result.systemPrompt;
  const activePromptIds = result.activePromptIds;
  let systemReminder = result.systemReminder;

  // Inject governance context (was F-02 inline content)
  if (context.conversation.owner_type === "knowledge_governance") {
    systemReminder += "\n\n" + buildGovernanceContext(variables);
  }

  // 架构约束校验：platform 层 + sop 层注入提示词总数不超过合理阈值
  validatePromptCount(activePromptIds, allPrompts);

  const skills = collectActiveSkills(activePromptIds, allPrompts);
  const guardProfile = resolveGuardProfile(context.project.guard_profile);

  return {
    systemPrompt,
    systemReminder,
    skills,
    mcpServers: [{ name: "snail-final-body", url: `http://localhost:${process.env.PORT || "3000"}/mcp` }],
    hooks: [],
    permissions: { defaultMode: "ask", rules: {} },
    tools: [],
    subAgents: [],
    guardProfile,
  };
}

function buildGovernanceContext(variables: Record<string, string>): string {
  const raw = [
    "## 知识治理上下文", "",
    "- 当前 Conversation 是知识中心治理对话，数据写入 knowledge_governance_* 专用表，不归属于任何项目管理 Feature、Stage 或 Conversation 表。",
    "- 软件只负责提取候选知识、打开治理对话和提供回写入口；入口校验、查重定性、系统提示词、skill、代码、测试、用户手册、设计决策或结论判断和最终去向，由当前治理对话中的 AI 基于事实完成。",
    "- 候选知识不会自动变成 active，也不会自动进入 prompt、skill、checker 或 tool；必须在治理结论中明确最终去向和是否允许运行时反哺。",
    "- 治理完成后，应通过知识治理 API 回写 entry_check_status、dedupe_status、scenario_type、disposition_status、artifact_type、final_destination、governance_pr_url、disposition_reason、deferred_reason、retrigger_condition、runtime_feedback_allowed 和 runtime_feedback_channels。",
    "- Governance ID: {{governance_id}}",
    "- Knowledge ID: {{knowledge_id}}",
    "- 候选标题: {{knowledge_title}}",
    "- 候选类型: {{knowledge_kind}}",
    "- 候选作用域: {{knowledge_scope}}",
    "- 候选内容: {{knowledge_content}}",
    "- 候选理由: {{knowledge_rationale}}",
    "- 当前入口校验: {{governance_entry_check_status}}",
    "- 当前查重状态: {{governance_dedupe_status}}",
    "- 当前场景类型: {{governance_scenario_type}}",
    "- 当前裁决状态: {{governance_disposition_status}}",
    "- 当前产物类型: {{governance_artifact_type}}",
    "- 关联知识: {{governance_related_knowledge_ids}}",
    "- 来源: {{knowledge_sources}}",
  ].join("\n");
  return renderPromptTemplate(raw, variables);
}

export interface HandbookRef { id: string; scope: "global" | "project"; }
export function resolveHandbookRef(ref: string | null | undefined): HandbookRef | null {
  if (!ref) return null;
  if (ref.startsWith("global:")) return { id: ref.slice("global:".length), scope: "global" };
  if (ref.startsWith("project:")) return { id: ref.slice("project:".length), scope: "project" };
  return { id: ref, scope: "global" };
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  return Object.assign(
    buildProject(context),
    buildFeature(context),
    buildStage(context),
    buildRole(context),
    buildConversation(context),
    buildHistory(context, path.join(PLATFORM_META, "scripts", "conversation-history")),
    buildGovernanceVars(context),
    buildKnowledgeLib(context),
  ) as Record<string, string>;
}

function buildProject(c: PromptBuildContext) { return { project_id: c.project.id, project_name: c.project.name, project_summary: c.project.summary ?? "无" }; }
function buildFeature(c: PromptBuildContext) { const a = c.feature.task_anchor; return { feature_title: c.feature.title, feature_summary: c.feature.summary ?? "无", feature_task_anchor_block: a ? `\n<task_anchor>\n[HARD] 以下任务锚在每次关键决策前必须重新对照，不得静默偏离：\n\n${a}\n</task_anchor>` : "" }; }

function buildStage(c: PromptBuildContext) {
  const input = c.stage.input_artifacts ?? {}, output = c.stage.output_artifacts;
  const fmt = (r: Record<string, string>) => Object.entries(r).length ? Object.entries(r).map(([k,v]) => `${k}: ${v}`).join(", ") : "无";
  const fmtB = (r: Record<string, string>) => Object.entries(r).length ? Object.entries(r).map(([k,v]) => `- ${k}: ${v}`).join("\n") : "- 无";
  const sp = STAGES[c.stage.type] ?? { label: c.stage.type, next: "" };
  return {
    stage_id: c.stage.id, feature_id: c.stage.feature_id,
    stage_title: c.stageDefinition.title,
    stage_progress_label: sp.label, stage_next_action: sp.next,
    stage_input_description: c.stageDefinition.input_description ?? "无",
    stage_output_description: c.stageDefinition.output_description ?? "无",
    stage_acceptance_focus_block: c.stageDefinition.acceptance_focus.map(i => `- 验收关注点: ${i}`).join("\n"),
    stage_artifact_requirements_block: c.stageDefinition.acceptance_focus.map(i => `- ${i}`).join("\n"),
    stage_output_artifacts: fmt(output), stage_input_artifacts: fmt(input),
    stage_input_artifacts_block: fmtB(input),
    stage_input: c.stageDefinition.input_description ?? "无",
    stage_output_summary: fmt(output),
    stage_required_artifacts: c.stageDefinition.output_description ?? "无",
  };
}
const STAGES: Record<string, {label:string;next:string}> = {
  development: { label: "研发迭代 (第 1/2 阶段)", next: "环境准备 (GATE-1~GATE-4)，详见 developer-handbook skill" },
  review: { label: "PR 检视 (第 2/2 阶段)", next: "准备与上下文加载 (GATE-1~GATE-4)，详见 reviewer-handbook skill" },
};

function buildRole(c: PromptBuildContext) {
  const a = c.activeRole;
  return {
    active_role_name: a?.name ?? c.conversation.default_role,
    default_role_name: c.defaultRole?.name ?? c.conversation.default_role,
    participating_roles: c.participatingRoles.map(r => r.name).join("、") || "无",
    remaining_rounds: String(c.remainingCollaborationRounds ?? 0),
    mention_allowed: c.mentionAllowed === false ? "否" : "是",
    forced_wrap_up_line: c.forcedWrapUp ? "- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再继续 mention 其他 Role" : "",
    active_role_identity_line: a ? `- 当前 Role 身份: ${a.description}` : "",
    active_role_working_rules_block: a?.working_rules.map(i => `- 当前 Role 工作规则: ${i}`).join("\n") ?? "",
    participating_role_details_block: c.participatingRoles.map(r => `- 参与 Role: ${r.name} | ${r.description}`).join("\n"),
  };
}

function buildConversation(c: PromptBuildContext) {
  return { conversation_title: c.conversation.title, conversation_kind: c.conversation.kind, conversation_sources: c.conversation.from_conversation_ids.join(", ") || "无", conversation_summary: c.conversation.summary ?? "无" };
}

function buildHistory(c: PromptBuildContext, sp: string) {
  return { history_script_path: sp, conversation_id: c.conversation.id, history_search_example: `${sp} --mode search --conversation-id ${c.conversation.id} --query "关键词" --limit 5`, history_window_example: `${sp} --mode window --conversation-id ${c.conversation.id} --anchor-message-id 123 --before 2 --after 2`, history_by_ids_example: `${sp} --mode by-ids --conversation-id ${c.conversation.id} --message-ids 123,124` };
}

function buildGovernanceVars(c: PromptBuildContext) {
  const g = c.knowledgeGovernanceContext;
  if (!g) return {};
  return {
    governance_id: g.governance.id, knowledge_id: g.knowledge.id,
    knowledge_title: g.knowledge.title, knowledge_kind: g.knowledge.kind,
    knowledge_scope: `${g.knowledge.scope_type}:${g.knowledge.scope_ref ?? "*"}`,
    knowledge_content: g.knowledge.content, knowledge_rationale: g.knowledge.rationale ?? "无",
    governance_entry_check_status: g.governance.entry_check_status,
    governance_dedupe_status: g.governance.dedupe_status,
    governance_scenario_type: g.governance.scenario_type,
    governance_disposition_status: g.governance.disposition_status,
    governance_artifact_type: g.governance.artifact_type,
    governance_related_knowledge_ids: g.governance.related_knowledge_ids.join(", ") || "无",
    knowledge_sources: g.knowledge.sources.map(s => `${s.source_type}:${s.source_id}${s.quote ? ` | ${s.quote}` : ""}`).join("; ") || "无",
  };
}

const KL: Record<string,string> = { constraint:"约束", decision:"决策", pattern:"模式", anti_pattern:"反模式", term:"术语", procedure:"过程" };
function buildKnowledgeLib(c: PromptBuildContext) {
  const s = c.knowledgeLibrarySummaries;
  if (!s?.length) return { knowledge_library_summary: "知识库当前为空。" };
  return { knowledge_library_summary: `当前知识库：${s.map(x => `${x.kind}/${KL[x.kind]??x.kind} ${x.count} 条`).join("、")}。通过 knowledge-library skill 的 list --kind <类别> 查阅某类简要信息（L2），通过 get --id <条目ID> 查阅全文（L3）。` };
}

/**
 * 架构约束校验：按 layer 维度校验活跃提示词数量。
 * platform 层 ≤ 6, sop 层 ≤ 3（含角色手册），仅输出 warning 日志，不阻断构建。
 */
function validatePromptCount(activePromptIds: string[], allPrompts: PromptDocument[]): void {
  const MAX_PLATFORM = 6;
  const MAX_SOP = 3;

  const layerCount = new Map<string, string[]>();
  for (const id of activePromptIds) {
    const prompt = allPrompts.find((p) => p.id === id);
    const layer = prompt?.layer ?? "unknown";
    if (!layerCount.has(layer)) layerCount.set(layer, []);
    layerCount.get(layer)!.push(id);
  }

  const platformCount = (layerCount.get("platform") ?? []).length;
  const sopCount = (layerCount.get("sop") ?? []).length;

  if (platformCount > MAX_PLATFORM) {
    console.warn(`[prompt-center] platform 层 prompt 数量 ${platformCount} 超过上限 ${MAX_PLATFORM}，当前: ${layerCount.get("platform")!.join(", ")}。请考虑将次级约束移入 prompt-constraints skill 或知识库。`);
  }
  if (sopCount > MAX_SOP) {
    console.warn(`[prompt-center] sop 层 prompt 数量 ${sopCount} 超过上限 ${MAX_SOP}，当前: ${layerCount.get("sop")!.join(", ")}。请考虑将次级约束移入 prompt-constraints skill 或知识库。`);
  }
}
