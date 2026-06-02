import path from "path";
import { assembleSystemPrompt, renderPromptTemplate, listPrompts, loadWorkspacePrompts, mergePrompts, type PromptMatchContext } from "./registry";
import { PLATFORM_META } from "../shared/platform-paths";
import type { Conversation, Feature, EvolutionItemWithConversation, Workspace, WorkspaceStageDefinition, StageRoleDefinition, StageType } from "../shared/types";
import type { AgentRuntime } from "../shared/types";
import type { RoleDefinition } from "../roles";
import { collectActiveSkills } from "../agent/capability";
import type { AgentCapability } from "../agent/capability";
import { resolveGuardProfile } from "../agent/guard-config";
import { collectActiveMcpServers } from "../mcp/registry";

export interface PromptBuildContext {
  workspace: Workspace;
  feature: Feature;
  stage: { id: string; feature_id: string; type: StageType; output_artifacts: Record<string, string>; input_artifacts?: Record<string, string> };
  conversation: Conversation;
  stageDefinition: WorkspaceStageDefinition;
  roleDefinitions: StageRoleDefinition[];
  activeRole?: RoleDefinition;
  defaultRole?: RoleDefinition;
  participatingRoles: RoleDefinition[];
  runtime?: AgentRuntime;
  evolutionContext?: { evolutionItem: EvolutionItemWithConversation };
  remainingCollaborationRounds?: number;
  mentionAllowed?: boolean;
  forcedWrapUp?: boolean;
  knowledgeLibrarySummaries?: { scope: string; count: number }[];
  /** 当前响应 Snail 的可展示名称，从 SnailTemplate.name 获取。 */
  snailDisplayName?: string;
}

export function buildConversationSystemPrompt(context: PromptBuildContext): { systemPrompt: string; capability: AgentCapability } {
  const capability = buildConversationCapability(context);
  return { systemPrompt: capability.systemPrompt, capability };
}

export function buildConversationCapability(context: PromptBuildContext): AgentCapability {
  const variables = buildTemplateVariables(context);
  assertCriticalVariables(variables);
  const matchContext: PromptMatchContext = {
    runtime: context.runtime,
    stageType: context.stage.type as StageType,
    roleName: context.activeRole?.name,
    conversationKind: context.conversation.kind,
    ownerType: context.conversation.owner_type,
  };

  const workspacePrompts = loadWorkspacePrompts(context.workspace.workspace_root);
  const allPrompts = mergePrompts(listPrompts(), workspacePrompts);

  // Exclude standalone task prompts (used directly by summary/mention tools)
  const assemblyPrompts = allPrompts.filter((p) => p.id !== "S-05" && p.id !== "S-06");

  const result = assembleSystemPrompt({
    prompts: assemblyPrompts,
    matchContext,
    variables,
  });
  const systemPrompt = result.systemPrompt;
  let systemReminder = result.systemReminder;

  // Inject evolution context (was F-02 inline content)
  if (context.conversation.owner_type === "evolution") {
    systemReminder += "\n\n" + buildEvolutionContext(variables);
  }

  const skills = collectActiveSkills(context.workspace.workspace_root);
  const guardProfile = resolveGuardProfile(context.workspace.guard_profile);

  return {
    systemPrompt,
    systemReminder,
    skills,
    mcpServers: collectActiveMcpServers(context.workspace.workspace_root),
    hooks: [],
    permissions: { defaultMode: "ask", rules: {} },
    tools: [],
    subAgents: [],
    guardProfile,
  };
}

function buildEvolutionContext(variables: Record<string, string>): string {
  const raw = [
    "## 演进治理上下文", "",
    "- 当前 Conversation 是演进中心治理对话，数据写入 evolution_item 表。",
    "- 软件只负责提取演进候选、打开治理对话和提供回写入口；入口校验、查重定性、系统提示词、skill、代码、测试、用户手册、设计决策或结论判断和最终去向，由当前治理对话中的 AI 基于事实完成。",
    "- 治理完成后，应通过演进 API 回写 feature_id 等字段。",
    "- Evolution Item ID: {{evolution_item_id}}",
    "- 标题: {{evolution_title}}",
    "- 内容: {{evolution_content}}",
    "- 标签: {{evolution_tags}}",
  ].join("\n");
  return renderPromptTemplate(raw, variables);
}

export interface HandbookRef { id: string; scope: "global" | "workspace"; }
export function resolveHandbookRef(ref: string | null | undefined): HandbookRef | null {
  if (!ref) return null;
  if (ref.startsWith("global:")) return { id: ref.slice("global:".length), scope: "global" };
  if (ref.startsWith("workspace:")) return { id: ref.slice("workspace:".length), scope: "workspace" };
  return { id: ref, scope: "global" };
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  return Object.assign(
    buildWorkspace(context),
    buildFeature(context),
    buildStage(context),
    buildRole(context),
    buildConversation(context),
    buildHistory(context, path.join(PLATFORM_META, "scripts", "conversation-history")),
    buildEvolutionVars(context),
    buildKnowledgeLib(context),
  ) as Record<string, string>;
}

/**
 * 关键模板变量非空校验。
 *
 * stage_id / feature_id / workspace_name / active_role_name 是系统上下文的核心标识，
 * 必须由 prompt center 注入——如果为空，说明上游数据链路有故障，
 * 应立即报错而非让 agent 看到空壳上下文静默运行。
 */
function assertCriticalVariables(vars: Record<string, string>): void {
  const CRITICAL = ["stage_id", "feature_id", "workspace_name", "active_role_name"];
  const missing = CRITICAL.filter((k) => !vars[k]);
  if (missing.length) {
    throw new Error("[prompt-center] 关键模板变量为空: " + missing.join(", ") + "。上下文注入链路故障，拒绝生成空壳 system prompt。");
  }
}

function buildWorkspace(c: PromptBuildContext) { return { workspace_id: c.workspace.id, workspace_name: c.workspace.name, workspace_summary: c.workspace.summary ?? "无" }; }
function buildFeature(c: PromptBuildContext) { const a = c.feature.task_anchor; return { feature_title: c.feature.title, feature_summary: c.feature.summary ?? "无", feature_task_anchor_block: a ? `\n<task_anchor>\n[HARD] 以下任务锚在每次关键决策前必须重新对照，不得静默偏离：\n\n${a}\n</task_anchor>` : "" }; }

function buildStage(c: PromptBuildContext) {
  const input = c.stage.input_artifacts ?? {}, output = c.stage.output_artifacts;
  const fmt = (r: Record<string, string>) => Object.entries(r).length ? Object.entries(r).map(([k,v]) => `${k}: ${v}`).join(", ") : "无";
  const fmtB = (r: Record<string, string>) => Object.entries(r).length ? Object.entries(r).map(([k,v]) => `- ${k}: ${v}`).join("\n") : "- 无";
  const sp = STAGES[c.stage.type] ?? { label: c.stage.type, next: "" };
  const checklist = c.stageDefinition.acceptance_checklist ?? [];
  const checklistBlock = checklist.length > 0
    ? checklist.map(item => `- [${item.required ? "必填" : "可选"}] ${item.id}: ${item.description}`).join("\n")
    : "无";
  return {
    stage_id: c.stage.id, feature_id: c.stage.feature_id,
    stage_title: c.stageDefinition.title,
    stage_progress_label: sp.label, stage_next_action: sp.next,
    stage_input_description: c.stageDefinition.input_description ?? "无",
    stage_output_description: c.stageDefinition.output_description ?? "无",
    stage_acceptance_focus_block: c.stageDefinition.acceptance_focus.map(i => `- 验收关注点: ${i}`).join("\n"),
    stage_artifact_requirements_block: c.stageDefinition.acceptance_focus.map(i => `- ${i}`).join("\n"),
    stage_acceptance_checklist_block: checklistBlock,
    stage_output_artifacts: fmt(output), stage_input_artifacts: fmt(input),
    stage_input_artifacts_block: fmtB(input),
    stage_input: c.stageDefinition.input_description ?? "无",
    stage_output_summary: fmt(output),
    stage_required_artifacts: c.stageDefinition.output_description ?? "无",
  };
}
const STAGES: Record<string, {label:string;next:string}> = {
  design: { label: "需求对齐与设计 (第 1/4 阶段)", next: "加载需求背景，开始交叉审视，详见 designer-handbook skill" },
  development: { label: "研发实现 (第 2/4 阶段)", next: "环境准备 (GATE-1~GATE-4)，详见 developer-handbook skill" },
  review: { label: "PR 检视 (第 3/4 阶段)", next: "准备与上下文加载 (GATE-1~GATE-4)，详见 reviewer-handbook skill" },
  merge: { label: "合入 (第 4/4 阶段)", next: "执行硬性条件检查，详见 merger-handbook skill" },
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
    snail_display_name: c.snailDisplayName ?? "",
  };
}

function buildConversation(c: PromptBuildContext) {
  return { conversation_title: c.conversation.title, conversation_kind: c.conversation.kind, conversation_sources: c.conversation.from_conversation_ids.join(", ") || "无", conversation_summary: c.conversation.summary ?? "无" };
}

function buildHistory(c: PromptBuildContext, sp: string) {
  return { history_script_path: sp, conversation_id: c.conversation.id, history_search_example: `${sp} --mode search --conversation-id ${c.conversation.id} --query "关键词" --limit 5`, history_window_example: `${sp} --mode window --conversation-id ${c.conversation.id} --anchor-message-id 123 --before 2 --after 2`, history_by_ids_example: `${sp} --mode by-ids --conversation-id ${c.conversation.id} --message-ids 123,124` };
}

function buildEvolutionVars(c: PromptBuildContext) {
  const e = c.evolutionContext;
  if (!e) return {};
  return {
    evolution_item_id: e.evolutionItem.id,
    evolution_title: e.evolutionItem.title,
    evolution_content: e.evolutionItem.content,
    evolution_tags: (typeof e.evolutionItem.tags === "string" ? JSON.parse(e.evolutionItem.tags) : e.evolutionItem.tags).join(", ") || "无",
  };
}

const SCOPE_LABELS: Record<string, string> = { global: "全局", workspace: "工作区" };
function buildKnowledgeLib(c: PromptBuildContext) {
  const s = c.knowledgeLibrarySummaries;
  if (!s?.length) return { knowledge_library_summary: "知识库当前为空。" };
  return { knowledge_library_summary: `当前知识库：${s.map(x => `${SCOPE_LABELS[x.scope] ?? x.scope} ${x.count} 条`).join("、")}。通过 knowledge-library skill 的 list --scope <作用域> 按作用域查阅简要信息（L2），通过 get --id <条目ID> 查阅全文（L3）。` };
}
