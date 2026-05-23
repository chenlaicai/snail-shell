import path from "path";
import { getFrame, renderFrame, listPrompts, type FrameMatchContext, type FrameDocument, type PromptDocument } from "./registry";
import type { Conversation, Feature, KnowledgeGovernance, KnowledgeWithDetails, Project, ProjectStageDefinition, StageRoleDefinition, StageType } from "../shared/types";
import type { AgentRuntime } from "../shared/types";
import type { RoleDefinition } from "../roles";
import { collectActiveSkills } from "../agent/capability";
import type { AgentCapability, SkillCapability } from "../agent/capability";

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
  knowledgeGovernanceContext?: {
    governance: KnowledgeGovernance;
    knowledge: KnowledgeWithDetails;
  };
  remainingCollaborationRounds?: number;
  mentionAllowed?: boolean;
  forcedWrapUp?: boolean;
}

/**
 * 为 conversation 构建系统提示词 + 结构化能力声明。
 *
 * 这是 prompt-center 对外的主入口函数。
 * 返回结构化结果而非单一字符串，使得上游可以：
 * - 仅取 systemPrompt 文本保持向后兼容
 * - 同时获取 capability 做结构化能力注入
 */
export function buildConversationSystemPrompt(context: PromptBuildContext): { systemPrompt: string; capability: AgentCapability } {
  const capability = buildConversationCapability(context);
  return { systemPrompt: capability.systemPrompt, capability };
}

/**
 * 构建 AgentCapability（ACP 协议的完整能力声明）。
 *
 * 组装流程：
 * 1. renderFrame → 渲染 frame + prompt 文本
 * 2. filterActivePromptIds → 按 {{#when}} 条件过滤，只保留活跃 prompt
 * 3. collectActiveSkills → 从活跃 prompt 的 skill_references 翻译为 ACP SkillCapability[]
 * 4. injectSkills → 将所有活跃 skill 完整内容嵌入 systemPrompt
 * 5. 返回 AgentCapability { systemPrompt(完整), skills, ... }
 *
 * systemPrompt 出厂即完整，agent adapter 只需直接使用，
 * 不做任何再组装动作。
 */
export function buildConversationCapability(context: PromptBuildContext): AgentCapability {
  const variables = buildTemplateVariables(context);
  const frameContext = buildFrameMatchContext(context);

  const frameId = context.conversation.owner_type === "knowledge_governance" ? "F-02" : "F-01";
  const frame = getFrame(frameId);

  // 1. 渲染 frame → 产生 systemPrompt 文本
  let systemPrompt = renderFrame(frame, frameContext, variables);

  // 2. 收集 skills——只从实际出现在 systemPrompt 中的 prompt 收集
  //    因为 {{#when:...}} 条件可能会过滤掉某些 prompt（如按 role 互斥的 S-03/S-04），
  //    被过滤的 prompt 的 skill 不应该注入当前 agent
  const allPrompts = listPrompts();
  const referencedPromptIds = extractPromptReferences(frame.content);
  const activePromptIds = filterActivePromptIds(referencedPromptIds, allPrompts, systemPrompt);
  const skills = collectActiveSkills(activePromptIds, allPrompts);

  // 4. 将所有活跃 skill 内容嵌入 systemPrompt
  systemPrompt = injectSkills(systemPrompt, skills);

  return {
    systemPrompt,

    // ACP 结构化能力字段
    skills,

    // TODO: 以下字段已定义协议结构，待 Snail Shell 系统调用实现后填充
    mcpServers: [],
    hooks: [],
    permissions: { defaultMode: "ask", rules: {} },
    tools: [],
    subAgents: [],
  };
}

export function buildFromFrame(frame: FrameDocument, frameContext: FrameMatchContext, variables: Record<string, string>): string {
  return renderFrame(frame, frameContext, variables);
}

function buildFrameMatchContext(context: PromptBuildContext): FrameMatchContext {
  return {
    runtime: context.runtime,
    stageType: context.stage.type as StageType,
    roleName: context.activeRole?.name,
    conversationKind: context.conversation.kind,
    ownerType: context.conversation.owner_type,
  };
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  return {
    ...buildProjectVariables(context),
    ...buildFeatureVariables(context),
    ...buildStageVariables(context),
    ...buildRoleVariables(context),
    ...buildConversationVariables(context),
    ...buildHistoryVariables(context, historyScriptPath, dbPath),
    ...buildGovernanceVariables(context),
  };
}

function buildProjectVariables(context: PromptBuildContext): Record<string, string> {
  return {
    project_id: context.project.id,
    project_name: context.project.name,
    project_summary: context.project.summary ?? "无",
  };
}

function buildFeatureVariables(context: PromptBuildContext): Record<string, string> {
  const taskAnchor = context.feature.task_anchor;
  return {
    feature_title: context.feature.title,
    feature_summary: context.feature.summary ?? "无",
    feature_status: context.feature.status,
    feature_task_anchor_block: taskAnchor
      ? `\n<task_anchor>\n[HARD] 以下任务锚在每次关键决策前（冲突解决、方案取舍、范围判断）必须重新对照，不得静默偏离：\n\n${taskAnchor}\n</task_anchor>`
      : "",
  };
}

function buildStageVariables(context: PromptBuildContext): Record<string, string> {
  const inputArtifacts = context.stage.input_artifacts ?? {};
  const outputArtifacts = context.stage.output_artifacts;

  const formatRecord = (record: Record<string, string>): string => {
    const entries = Object.entries(record);
    if (entries.length === 0) return "无";
    return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
  };

  const formatRecordBlock = (record: Record<string, string>): string => {
    const entries = Object.entries(record);
    if (entries.length === 0) return "- 无";
    return entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");
  };

  const outputSummary = formatRecord(outputArtifacts);
  const inputSummary = formatRecord(inputArtifacts);

  return {
    stage_id: context.stage.id,
    feature_id: context.stage.feature_id,
    stage_title: context.stageDefinition.title,
    stage_input: context.stageDefinition.input_description ?? "无",
    stage_input_description: context.stageDefinition.input_description ?? "无",
    stage_output_summary: outputSummary,
    stage_required_artifacts: context.stageDefinition.output_description ?? "无",
    stage_output_description: context.stageDefinition.output_description ?? "无",
    stage_acceptance_focus_block: context.stageDefinition.acceptance_focus.map((item) => `- 验收关注点: ${item}`).join("\n"),
    stage_artifact_requirements_block: context.stageDefinition.acceptance_focus.map((item) => `- ${item}`).join("\n"),
    stage_output_artifacts: outputSummary,
    stage_input_artifacts: inputSummary,
    stage_input_artifacts_block: formatRecordBlock(inputArtifacts),
  };
}

function buildRoleVariables(context: PromptBuildContext): Record<string, string> {
  const activeRole = context.activeRole;
  return {
    active_role_name: activeRole?.name ?? context.conversation.default_role,
    default_role_name: context.defaultRole?.name ?? context.conversation.default_role,
    participating_roles: context.participatingRoles.map((item) => item.name).join("、") || "无",
    remaining_rounds: String(context.remainingCollaborationRounds ?? 0),
    mention_allowed: context.mentionAllowed === false ? "否" : "是",
    forced_wrap_up_line: context.forcedWrapUp ? "- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再继续 mention 其他 Role" : "",
    active_role_identity_line: activeRole ? `- 当前 Role 身份: ${activeRole.description}` : "",
    active_role_working_rules_block: activeRole?.working_rules.map((item) => `- 当前 Role 工作规则: ${item}`).join("\n") ?? "",
    participating_role_details_block: context.participatingRoles.map((role) => `- 参与 Role: ${role.name} | ${role.description}`).join("\n"),
  };
}

function buildConversationVariables(context: PromptBuildContext): Record<string, string> {
  return {
    conversation_title: context.conversation.title,
    conversation_kind: context.conversation.kind,
    conversation_sources: context.conversation.from_conversation_ids.join(", ") || "无",
    conversation_summary: context.conversation.summary ?? "无",
  };
}

function buildHistoryVariables(context: PromptBuildContext, historyScriptPath: string, dbPath: string): Record<string, string> {
  return {
    history_script_path: historyScriptPath,
    db_path: dbPath,
    conversation_id: context.conversation.id,
    history_search_example: `${historyScriptPath} --mode search --db-path "${dbPath}" --conversation-id ${context.conversation.id} --query "关键词" --limit 5`,
    history_window_example: `${historyScriptPath} --mode window --db-path "${dbPath}" --conversation-id ${context.conversation.id} --anchor-message-id 123 --before 2 --after 2`,
    history_by_ids_example: `${historyScriptPath} --mode by-ids --db-path "${dbPath}" --conversation-id ${context.conversation.id} --message-ids 123,124`,
  };
}

function buildGovernanceVariables(context: PromptBuildContext): Record<string, string> {
  const gc = context.knowledgeGovernanceContext;
  if (!gc) {
    return {};
  }
  const { governance, knowledge } = gc;
  return {
    governance_id: governance.id,
    knowledge_id: knowledge.id,
    knowledge_title: knowledge.title,
    knowledge_kind: knowledge.kind,
    knowledge_scope: `${knowledge.scope_type}:${knowledge.scope_ref ?? "*"}`,
    knowledge_content: knowledge.content,
    knowledge_rationale: knowledge.rationale ?? "无",
    governance_entry_check_status: governance.entry_check_status,
    governance_dedupe_status: governance.dedupe_status,
    governance_scenario_type: governance.scenario_type,
    governance_disposition_status: governance.disposition_status,
    governance_artifact_type: governance.artifact_type,
    governance_related_knowledge_ids: governance.related_knowledge_ids.join(", ") || "无",
    knowledge_sources: knowledge.sources.map((source) => `${source.source_type}:${source.source_id}${source.quote ? ` | ${source.quote}` : ""}`).join("; ") || "无",
  };
}

/**
 * 从 frame 静态引用中过滤出实际激活的 prompt ID。
 *
 * 过滤策略：每个 prompt 通过其 ## 标题行是否出现在 rendered systemPrompt 中判断。
 * 因为 {{#when:...}} 条件可能会移除不匹配 role/stage 的 prompt 段落，
 * 这些 prompt 的 skill_references 不应被收集。
 */
function filterActivePromptIds(
  promptIds: string[],
  allPrompts: PromptDocument[],
  systemPrompt: string,
): string[] {
  return promptIds.filter((id) => {
    const prompt = allPrompts.find((p) => p.id === id);
    if (!prompt) return false;
    const titleMatch = prompt.content.match(/^##\s+([^\n]+)/m);
    if (!titleMatch) return true; // 无标题时保守包含
    return systemPrompt.includes(titleMatch[1].trim());
  });
}

/**
 * 从 frame 内容中提取 {{prompt:ID}} 引用。
 * 返回所有被引用的 prompt ID 列表。
 */
function extractPromptReferences(frameContent: string): string[] {
  const pattern = /\{\{prompt:([A-Z]-\d+)\}\}/g;
  const ids: string[] = [];
  let match;
  while ((match = pattern.exec(frameContent)) !== null) {
    if (match[1]) ids.push(match[1]);
  }
  return ids;
}

/**
 * 将所有活跃 skill 的完整内容嵌入 systemPrompt 末尾。
 *
 * 活跃 skill 指 filterActivePromptIds 过滤后，对应 prompt 的
 * skill_references 中声明的 skill。不区分 required/conditional，
 * 因为被 {{#when}} 过滤掉的 prompt 的 skill 已经不在收集中。
 */
function injectSkills(systemPrompt: string, skills: SkillCapability[]): string {
  if (skills.length === 0) return systemPrompt;

  const skillBlocks = skills.map((skill) => {
    const stripped = skill.content.replace(/^#\s+.+\n+/m, "");
    return [
      `### ${skill.name}`,
      `以下为该 skill 的完整操作协议。必须严格遵守其中的步骤和命令格式。`,
      "",
      stripped,
    ].join("\n");
  });

  const section = [
    "",
    "---",
    "## 能力注入",
    "",
    `以下 ${skills.length} 个 skill 已直接注入，无需再读取文件：`,
    "",
    ...skillBlocks,
    "",
    "---",
    "",
  ].join("\n");

  return systemPrompt.trimEnd() + "\n" + section;
}
