import path from "path";
import { type StageDefinition } from "../meta";
import { getSkill } from "../skill-center";
import { listPromptDocumentsForTarget, renderPromptContent, renderPromptOutline, type PromptMatchContext, type PromptSkillReference } from "./registry";
import type { Artifact, Conversation, Feature, KnowledgeGovernance, KnowledgeWithDetails, Project, Stage, StageType } from "../shared/types";
import type { SnailDefinition } from "../snails/registry";

export interface PromptBuildContext {
  project: Project;
  feature: Feature;
  stage: Stage;
  conversation: Conversation;
  stageDefinition: StageDefinition;
  activeSnail?: SnailDefinition;
  defaultSnail?: SnailDefinition;
  participatingSnails: SnailDefinition[];
  inputArtifacts?: Artifact[];
  knowledgeContext?: KnowledgeWithDetails[];
  knowledgeGovernanceContext?: {
    governance: KnowledgeGovernance;
    knowledge: KnowledgeWithDetails;
  };
  remainingCollaborationRounds?: number;
  mentionAllowed?: boolean;
  forcedWrapUp?: boolean;
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines].join("\n");
}

export function buildConversationSystemPrompt(context: PromptBuildContext): string {
  const variables = buildTemplateVariables(context);
  const assets = [
    ...listPromptDocumentsForTarget(buildPromptMatchContext(context, "ai.base.system")),
    ...listPromptDocumentsForTarget(buildPromptMatchContext(context, "scenario.project-conversation.work-context")),
  ];
  const parts: string[] = [];

  for (const asset of assets) {
    parts.push(renderPromptContent(asset, variables).trim());
    if (asset.skill_references?.length) {
      parts.push(buildSkillReferenceSection(asset.skill_references));
    }
  }

  parts.push(buildStageRolePlaybookSection(context));
  parts.push(buildKnowledgeGovernanceSection(context.knowledgeGovernanceContext));
  parts.push(buildKnowledgeContextSection(context.knowledgeContext ?? []));

  return parts.filter(Boolean).join("\n\n");
}

function buildKnowledgeGovernanceSection(context: PromptBuildContext["knowledgeGovernanceContext"]): string {
  if (!context) return "";
  const { governance, knowledge } = context;
  return section("知识治理上下文", [
    "- 当前 Conversation 是知识中心治理对话，数据写入 knowledge_governance_* 专用表，不归属于任何项目管理 Feature、Stage 或 Conversation 表。",
    "- 软件只负责提取候选知识、打开治理对话和提供回写入口；入口校验、查重定性、系统提示词/文档/代码 PR 判断和最终去向，由当前治理对话中的 AI 基于事实完成。",
    "- 候选知识不会自动变成 active，也不会自动进入 prompt、skill、checker 或 tool；必须在治理结论中明确最终去向和是否允许运行时反哺。",
    "- 如果需要让其他 Snail 继续处理、复检或收口，必须按 message-out mention 协议发出结构化 mention。",
    "- 治理完成后，应通过知识治理 API 回写 entry_check_status、dedupe_status、scenario_type、disposition_status、artifact_type、final_destination、governance_pr_url、disposition_reason、deferred_reason、retrigger_condition、runtime_feedback_allowed 和 runtime_feedback_channels。",
    `- Governance ID: ${governance.id}`,
    `- Knowledge ID: ${knowledge.id}`,
    `- 候选标题: ${knowledge.title}`,
    `- 候选类型: ${knowledge.kind}`,
    `- 候选作用域: ${knowledge.scope_type}:${knowledge.scope_ref ?? "*"}`,
    `- 候选内容: ${knowledge.content}`,
    `- 候选理由: ${knowledge.rationale ?? "无"}`,
    `- 当前入口校验: ${governance.entry_check_status}`,
    `- 当前查重状态: ${governance.dedupe_status}`,
    `- 当前场景类型: ${governance.scenario_type}`,
    `- 当前裁决状态: ${governance.disposition_status}`,
    `- 当前产物类型: ${governance.artifact_type}`,
    `- 关联知识: ${governance.related_knowledge_ids.join(", ") || "无"}`,
    `- 来源: ${knowledge.sources.map((source) => `${source.source_type}:${source.source_id}${source.quote ? ` | ${source.quote}` : ""}`).join("; ") || "无"}`,
  ]);
}

function buildKnowledgeContextSection(items: KnowledgeWithDetails[]): string {
  if (!items.length) {
    return section("知识上下文", ["- 当前没有匹配的已审批知识。"]);
  }

  return section("知识上下文", [
    "- 以下知识均已人工审批，并按当前 project、feature、stage 或 snail 范围匹配注入。",
    "- 候选、拒绝、废弃或跨范围知识不会自动进入本上下文。",
    ...items.map((item) => {
      const policy = item.usage_policy;
      const source = item.sources[0];
      const sourceText = source ? ` | 来源: ${source.source_type}:${source.source_id}` : "";
      const promptMode = policy?.prompt_mode ?? "reference_only";
      const content = promptMode === "full" ? item.content : clipKnowledgeText(item.content, 220);
      return `- ${item.id} | ${item.kind} | ${item.scope_type}:${item.scope_ref ?? "*"} | ${item.governance_level} | ${item.title}: ${content}${sourceText}`;
    }),
  ]);
}

function clipKnowledgeText(content: string, maxLength: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  return {
    ...buildProjectVariables(context),
    ...buildFeatureVariables(context),
    ...buildStageVariables(context),
    ...buildSnailVariables(context),
    ...buildConversationVariables(context),
    ...buildHistoryVariables(context, historyScriptPath, dbPath),
  };
}

function buildFeatureVariables(context: PromptBuildContext): Record<string, string> {
  return {
    feature_title: context.feature.title,
    feature_summary: context.feature.summary ?? "无",
    feature_status: context.feature.status,
    feature_branch_name: context.feature.branch_name ?? "无",
    feature_worktree_path: context.feature.worktree_path ?? "无",
    feature_pr_url: context.feature.pr_url ?? "无",
  };
}

function buildProjectVariables(context: PromptBuildContext): Record<string, string> {
  return {
    project_name: context.project.name,
    project_summary: context.project.summary ?? "无",
  };
}

function buildStageVariables(context: PromptBuildContext): Record<string, string> {
  return {
    stage_title: context.stageDefinition.title,
    stage_input: context.stageDefinition.input.join(", ") || "无",
    stage_input_artifacts_block: buildStageInputArtifactsBlock(context.inputArtifacts ?? []),
    stage_output_summary: context.stageDefinition.output.summary,
    stage_required_artifacts: context.stageDefinition.output.required_artifacts.join(", ") || "无",
    stage_artifact_requirements_block: context.stageDefinition.output.artifact_requirements.map((item) => `- 产物要求: ${item}`).join("\n"),
    stage_acceptance_focus_block: context.stageDefinition.acceptance_focus.map((item) => `- 验收关注点: ${item}`).join("\n"),
  };
}

function buildStageInputArtifactsBlock(artifacts: Artifact[]): string {
  if (!artifacts.length) {
    return "- 上一 Stage 输出产物: 无";
  }

  return artifacts.map((artifact) => {
    const content = summarizeArtifactContent(artifact);
    const detail = content ? `\n  > ${content}` : "";
    return `- 上一 Stage 输出产物: ${artifact.artifact_type} | ${artifact.title} | 状态: ${artifact.status}${detail}`;
  }).join("\n");
}

function summarizeArtifactContent(artifact: Artifact): string {
  const raw = artifact.inline_content ?? artifact.external_ref ?? artifact.file_path ?? artifact.metadata ?? "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  const truncated = normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
  return truncated.replace(/\n/g, "\n  > ");
}

function buildSnailVariables(context: PromptBuildContext): Record<string, string> {
  const activeSnail = context.activeSnail;
  return {
    active_snail_name: activeSnail?.name ?? context.conversation.default_snail,
    default_snail_name: context.defaultSnail?.name ?? context.conversation.default_snail,
    participating_snails: context.participatingSnails.map((item) => item.name).join("、") || "无",
    remaining_rounds: String(context.remainingCollaborationRounds ?? 0),
    mention_allowed: context.mentionAllowed === false ? "否" : "是",
    forced_wrap_up_line: context.forcedWrapUp ? "- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再继续 mention 其他 Snail" : "",
    active_snail_identity_line: activeSnail ? `- 当前 Snail 身份: ${activeSnail.description}` : "",
    active_snail_capabilities_line: activeSnail ? `- 当前 Snail 能力预期: ${activeSnail.capability_expectations.join("、") || "无"}` : "",
    active_snail_working_rules_block: activeSnail?.working_rules.map((item) => `- 当前 Snail 工作规则: ${item}`).join("\n") ?? "",
    active_snail_preferred_artifacts_line: activeSnail ? `- 当前 Snail 偏好产物: ${activeSnail.preferred_artifact_types.join(", ") || "无"}` : "",
    participating_snail_roles_block: context.participatingSnails.map((snail) => `- 参与 Snail 角色: ${snail.name} | ${snail.description}`).join("\n"),
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

function buildSkillReferenceSection(skills: PromptSkillReference[]): string {
  const lines = ["## Skill References", "", "- 以下 skill 是独立能力包；系统提示词只负责引用它们，不内嵌其完整正文。"];
  for (const item of skills) {
    const skill = getSkill(item.id);
    lines.push(`- ${item.mode === "required" ? "必须使用" : "按需使用"} skill: \`${skill.name}\``);
    lines.push(`  - 用途: ${skill.description}`);
    lines.push(`  - 路径: ${path.relative(process.cwd(), skill.filePath)}`);
    lines.push(`  - 规则: ${item.reason}`);
  }
  return lines.join("\n");
}

function buildStageRolePlaybookSection(context: PromptBuildContext): string {
  const matchedPrompts = listPromptDocumentsForTarget(buildPromptMatchContext(context, "scenario.project-conversation.stage-role-playbook"));
  if (!matchedPrompts.length) {
    return section("阶段角色手册", ["- 当前角色与 Stage 未命中额外行动手册。"]);
  }

  const lines = [
    "- 以下为当前角色与 Stage 命中的行动手册。",
    ...matchedPrompts.map((prompt) => `- 命中: ${prompt.id} | ${prompt.title}`),
    "",
  ];

  for (const prompt of matchedPrompts) {
    lines.push(`### ${prompt.title} (${prompt.id})`);
    lines.push(...renderPromptOutline(prompt, {}));
    lines.push("");
  }

  return section("阶段角色手册", lines);
}

function buildPromptMatchContext(context: PromptBuildContext, target: string): PromptMatchContext {
  return {
    target,
    runtime: context.activeSnail?.runtime,
    stageType: context.stage.type as StageType,
    snailName: context.activeSnail?.name,
    conversationKind: context.conversation.kind,
    repoRelated: isRepoRelated(context),
  };
}

function isRepoRelated(context: PromptBuildContext): boolean {
  return context.stageDefinition.repo_related === true;
}
