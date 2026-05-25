import path from "path";
import { getFrame, renderFrame, listPrompts, type FrameMatchContext, type FrameDocument, type PromptDocument } from "./registry";
import type { Conversation, Feature, KnowledgeGovernance, KnowledgeWithDetails, Project, ProjectStageDefinition, StageRoleDefinition, StageType } from "../shared/types";
import type { AgentRuntime } from "../shared/types";
import type { RoleDefinition } from "../roles";
import { collectActiveSkills } from "../agent/capability";
import type { AgentCapability } from "../agent/capability";
import type { KnowledgeLibraryKindSummary } from "../shared/knowledge-library-types";

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
  knowledgeLibrarySummaries?: KnowledgeLibraryKindSummary[];
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
 * 4. 返回 AgentCapability { systemPrompt, skills, ... }
 *
 * skill 正文不注入 systemPrompt。prompt 的 Skill References 段已提供
 * 渐进式披露（名称 + 路径 + 使用条件），模型按需查阅 SKILL.md。
 */
export function buildConversationCapability(context: PromptBuildContext): AgentCapability {
  const variables = buildTemplateVariables(context);
  const frameContext = buildFrameMatchContext(context);

  const frameId = context.conversation.owner_type === "knowledge_governance" ? "F-02" : "F-01";
  const frame = getFrame(frameId);

  // 1. 渲染 frame → 产生 systemPrompt 文本
  const systemPrompt = renderFrame(frame, frameContext, variables);

  // 2. 收集 skills——只从实际出现在 systemPrompt 中的 prompt 收集
  //    因为 {{#when:...}} 条件可能会过滤掉某些 prompt（如按 role 互斥的 S-03/S-04），
  //    被过滤的 prompt 的 skill 不应该注入当前 agent
  const allPrompts = listPrompts();
  const referencedPromptIds = extractPromptReferences(frame.content);
  const activePromptIds = filterActivePromptIds(referencedPromptIds, allPrompts, systemPrompt);
  const skills = collectActiveSkills(activePromptIds, allPrompts);

  // 不注入 skill 正文到 systemPrompt。
  // skill 已通过 prompt 的 Skill References 段渐进式披露（名称 + 路径 + 使用条件），
  // 模型按需自行查阅 SKILL.md。skill 元数据保留在 AgentCapability.skills 中，
  // 供各 agent adapter 未来做 native skill 注入。

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
  return {
    ...buildProjectVariables(context),
    ...buildFeatureVariables(context),
    ...buildStageVariables(context),
    ...buildRoleVariables(context),
    ...buildConversationVariables(context),
    ...buildHistoryVariables(context, historyScriptPath),
    ...buildGovernanceVariables(context),
    ...buildKnowledgeLibraryVariables(context),
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

  const stageProgress = getStageProgress(context.stage.type);

  return {
    stage_id: context.stage.id,
    feature_id: context.stage.feature_id,
    stage_title: context.stageDefinition.title,
    stage_progress_label: stageProgress.label,
    stage_next_action: stageProgress.nextAction,
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

function getStageProgress(stageType: string): { label: string; nextAction: string } {
  const STAGE_MAP: Record<string, { label: string; nextAction: string }> = {
    development: {
      label: "研发迭代 (第 1/2 阶段)",
      nextAction: "环境准备 (GATE-1~GATE-4)，详见 developer-handbook skill",
    },
    review: {
      label: "PR 检视 (第 2/2 阶段)",
      nextAction: "准备与上下文加载 (GATE-1~GATE-4)，详见 reviewer-handbook skill",
    },
  };
  return STAGE_MAP[stageType] ?? { label: stageType, nextAction: "详见对应 skill" };
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

function buildHistoryVariables(context: PromptBuildContext, historyScriptPath: string): Record<string, string> {
  return {
    history_script_path: historyScriptPath,
    conversation_id: context.conversation.id,
    history_search_example: `${historyScriptPath} --mode search --conversation-id ${context.conversation.id} --query "关键词" --limit 5`,
    history_window_example: `${historyScriptPath} --mode window --conversation-id ${context.conversation.id} --anchor-message-id 123 --before 2 --after 2`,
    history_by_ids_example: `${historyScriptPath} --mode by-ids --conversation-id ${context.conversation.id} --message-ids 123,124`,
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

const KIND_LABELS: Record<string, string> = {
  constraint: "约束",
  decision: "决策",
  pattern: "模式",
  anti_pattern: "反模式",
  term: "术语",
  procedure: "过程",
};

function buildKnowledgeLibraryVariables(context: PromptBuildContext): Record<string, string> {
  const summaries = context.knowledgeLibrarySummaries;
  if (!summaries || summaries.length === 0) {
    return { knowledge_library_summary: "知识库当前为空。" };
  }
  const parts = summaries.map((s) => `${s.kind}/${KIND_LABELS[s.kind] ?? s.kind} ${s.count} 条`);
  const summary = `当前知识库：${parts.join("、")}。通过 knowledge-library skill 的 list --kind <类别> 查阅某类简要信息（L2），通过 get --id <条目ID> 查阅全文（L3）。`;
  return { knowledge_library_summary: summary };
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
