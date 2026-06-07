import path from "path";
import { assembleSystemPrompt, renderPromptTemplate, listPrompts, mergePrompts, type PromptMatchContext, type PromptDocument } from "./registry";
import { PLATFORM_META } from "./platform-paths";
import type { Conversation, Issue, EvolutionItemWithConversation, Workspace, WorkspaceStageDefinition, StageRoleDefinition, StageType } from "../shared/types";
import type { AgentRuntime } from "../shared/types";
import type { RoleDefinition } from "../roles";
import { collectActiveSkills } from "../agent/capability";
import type { AgentCapability } from "../agent/capability";
import { resolveGuardProfile } from "../agent/guard-config";
import { collectActiveMcpServers } from "../mcp/registry";

/** workspace 级 skill 定义的最小接口，避免 prompt-center 直接依赖 skill-center 模块。 */
interface WorkspaceSkillDefinition {
  name: string;
  description: string;
  filePath: string;
  content: string;
  title: string;
  source: "platform" | "workspace";
}

export interface PromptBuildContext {
  workspace: Workspace;
  issue: Issue;
  stage: { id: string; issue_id: string; type: StageType; output_artifacts: Record<string, unknown>; input_artifacts?: Record<string, unknown> };
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
  /** SOP 级共享手册内容，包含所有角色通用的规则。 */
  sharedHandbook?: string | null;
  /** workspace 级 prompts（从 .snail/prompts/ 加载），由调用者注入以避免 prompt-center 依赖 workspace-workflow。 */
  workspacePrompts?: PromptDocument[];
  /** workspace 级 skills（从 .snail/skills/ 加载），由调用者注入以避免 prompt-center 依赖 workspace-workflow。 */
  workspaceSkills?: WorkspaceSkillDefinition[];
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

  const allPrompts = mergePrompts(listPrompts(), context.workspacePrompts ?? []);

  const assemblyPrompts = allPrompts;

  const result = assembleSystemPrompt({
    prompts: assemblyPrompts,
    matchContext,
    variables,
  });
  const systemPrompt = result.systemPrompt;
  let systemReminder = result.systemReminder;

  // Inject role handbook from SOP YAML content field
  const roleContent = buildRoleContent(context, variables);
  if (roleContent) {
    systemReminder = roleContent + "\n\n" + systemReminder;
  }

  // Inject evolution context (was F-02 inline content)
  if (context.conversation.owner_type === "evolution") {
    systemReminder += "\n\n" + buildEvolutionContext(variables);
  }

  const skills = collectActiveSkills(context.workspaceSkills ?? []);
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
    "- 治理完成后，应通过演进 API 回写 issue_id 等字段。",
    "- Evolution Item ID: {{evolution_item_id}}",
    "- 标题: {{evolution_title}}",
    "- 内容: {{evolution_content}}",
    "- 标签: {{evolution_tags}}",
  ].join("\n");
  return renderPromptTemplate(raw, variables);
}

/**
 * 从 activeRole.handbook 和 sharedHandbook 渲染角色手册，注入 systemReminder。
 *
 * Why: 角色手册内容（含工作规则）已从独立 prompt 文件内联到 SOP YAML 的 handbook 字段，
 * 由 builder 在运行时读取并渲染模板变量后拼入 systemReminder。
 * sharedHandbook 包含所有角色通用的规则（PR 签名模板、Stage Gate 自检等），先于角色手册注入。
 */
function buildRoleContent(c: PromptBuildContext, variables: Record<string, string>): string {
  const parts: string[] = [];
  if (c.sharedHandbook) {
    parts.push(renderPromptTemplate(c.sharedHandbook, variables));
  }
  const handbook = c.activeRole?.handbook;
  if (handbook) {
    parts.push(renderPromptTemplate(handbook, variables));
  }
  return parts.join("\n\n");
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  return Object.assign(
    buildWorkspace(context),
    buildIssue(context),
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
 * stage_id / issue_id / workspace_name / active_role_name 是系统上下文的核心标识，
 * 必须由 prompt center 注入——如果为空，说明上游数据链路有故障，
 * 应立即报错而非让 agent 看到空壳上下文静默运行。
 */
function assertCriticalVariables(vars: Record<string, string>): void {
  const CRITICAL = ["stage_id", "issue_id", "workspace_name", "active_role_name"];
  const missing = CRITICAL.filter((k) => !vars[k]);
  if (missing.length) {
    throw new Error("[prompt-center] 关键模板变量为空: " + missing.join(", ") + "。上下文注入链路故障，拒绝生成空壳 system prompt。");
  }
}

function buildWorkspace(c: PromptBuildContext) { return { workspace_id: c.workspace.id, workspace_name: c.workspace.name, workspace_summary: c.workspace.summary ?? "无" }; }
function buildIssue(c: PromptBuildContext) { const a = c.issue.task_anchor; return { issue_title: c.issue.title, issue_summary: c.issue.summary ?? "无", issue_task_anchor_block: a ? `\n<task_anchor>\n[HARD] 以下任务锚在每次关键决策前必须重新对照，不得静默偏离：\n\n${a}\n</task_anchor>` : "" }; }

function buildStage(c: PromptBuildContext) {
  const input = c.stage.input_artifacts ?? {}, output = c.stage.output_artifacts;
  /** 将 unknown 值序列化为字符串，对象走 JSON.stringify。 */
  const fmtVal = (v: unknown): string => typeof v === "string" ? v : JSON.stringify(v);
  const fmt = (r: Record<string, unknown>) => Object.entries(r).length ? Object.entries(r).map(([k,v]) => `${k}: ${fmtVal(v)}`).join(", ") : "无";
  const fmtB = (r: Record<string, unknown>) => Object.entries(r).length ? Object.entries(r).map(([k,v]) => `- ${k}: ${fmtVal(v)}`).join("\n") : "- 无";
  const stageLabel = `${c.stageDefinition.title} (${c.stage.type})`;
  const checklist = c.stageDefinition.acceptance_checklist ?? [];
  const checklistBlock = checklist.length > 0
    ? checklist.map(item => `- [${item.required ? "必填" : "可选"}] ${item.id}: ${item.description}`).join("\n")
    : "无";
  return {
    stage_id: c.stage.id, issue_id: c.stage.issue_id,
    stage_title: c.stageDefinition.title,
    stage_progress_label: stageLabel, stage_next_action: c.stageDefinition.output_description ?? "",
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
    participating_role_details_block: c.participatingRoles.map(r => `- 参与 Role: ${r.name} | ${r.description}`).join("\n"),
    snail_display_name: c.snailDisplayName ?? "",
  };
}

function buildConversation(c: PromptBuildContext) {
  return { conversation_title: c.conversation.title, conversation_kind: c.conversation.kind, conversation_sources: c.conversation.from_conversation_ids.join(", ") || "无", conversation_summary: c.conversation.summary ?? "无" };
}

function buildHistory(c: PromptBuildContext, sp: string) {
  return { history_script_path: sp };
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
