import path from "path";
import { getPromptDocument, getSkill, listPromptDocumentsForTarget, renderPromptContent, renderPromptOutline, type PromptMatchContext, type PromptSkillReference, type StageDefinition } from "../meta";
import type { Artifact, Conversation, Project, Stage, StageType } from "../persistence/store";
import type { SnailDefinition } from "./registry";

export interface PromptBuildContext {
  project: Project;
  stage: Stage;
  conversation: Conversation;
  stageDefinition: StageDefinition;
  activeSnail?: SnailDefinition;
  defaultSnail?: SnailDefinition;
  participatingSnails: SnailDefinition[];
  inputArtifacts?: Artifact[];
  remainingCollaborationRounds?: number;
  mentionAllowed?: boolean;
  forcedWrapUp?: boolean;
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines].join("\n");
}

export function buildConversationSystemPrompt(context: PromptBuildContext): string {
  const variables = buildTemplateVariables(context);
  const assets = listPromptDocumentsForTarget(buildPromptMatchContext(context, "conversation.system"));
  const parts: string[] = [];

  for (const asset of assets) {
    parts.push(renderPromptContent(asset, variables).trim());
    if (asset.inject_matched_prompts) {
      parts.push(buildMatchedGlobalPromptSection(context));
    }
    if (asset.skill_references?.length) {
      parts.push(buildSkillReferenceSection(asset.skill_references));
    }
  }

  return parts.filter(Boolean).join("\n\n");
}

function buildTemplateVariables(context: PromptBuildContext): Record<string, string> {
  const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  return {
    ...buildProjectVariables(context),
    ...buildStageVariables(context),
    ...buildSnailVariables(context),
    ...buildConversationVariables(context),
    ...buildHistoryVariables(context, historyScriptPath, dbPath),
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
  const activePrompt = activeSnail ? getPromptDocument(activeSnail.system_prompt.asset_id) : null;
  return {
    active_snail_name: activeSnail?.name ?? context.conversation.default_snail,
    default_snail_name: context.defaultSnail?.name ?? context.conversation.default_snail,
    participating_snails: context.participatingSnails.map((item) => item.name).join("、") || "无",
    remaining_rounds: String(context.remainingCollaborationRounds ?? 0),
    mention_allowed: context.mentionAllowed === false ? "否" : "是",
    forced_wrap_up_line: context.forcedWrapUp ? "- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再继续 mention 其他 Snail" : "",
    active_snail_profile_block: activePrompt?.content.trim() ?? "",
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

function buildMatchedGlobalPromptSection(context: PromptBuildContext): string {
  const matchedPrompts = listPromptDocumentsForTarget(buildPromptMatchContext(context, "conversation.system.global"));
  if (!matchedPrompts.length) {
    return section("通用重点注入", ["- 当前角色与场景未命中额外通用 prompt。"]);
  }

  const lines = [
    "- 以下为当前角色与场景命中的通用 prompt 重点。",
    ...matchedPrompts.map((prompt) => `- 命中: ${prompt.id} | ${prompt.title}`),
    "",
  ];

  for (const prompt of matchedPrompts) {
    lines.push(`### ${prompt.title} (${prompt.id})`);
    lines.push(...renderPromptOutline(prompt, {}));
    lines.push("");
  }

  return section("通用重点注入", lines);
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
