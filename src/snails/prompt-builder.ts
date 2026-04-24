import path from "path";
import { getAssembly, getRegulationExpandScriptPath, getSkill, getSystemPromptAsset, listRegulations, matchRegulations, renderTemplate, type StageDefinition } from "../meta";
import type { Conversation, Project, Stage } from "../persistence/store";
import type { SnailDefinition } from "./registry";

export interface PromptBuildContext {
  project: Project;
  stage: Stage;
  conversation: Conversation;
  stageDefinition: StageDefinition;
  activeSnail?: SnailDefinition;
  defaultSnail?: SnailDefinition;
  participatingSnails: SnailDefinition[];
  remainingCollaborationRounds?: number;
  mentionAllowed?: boolean;
  forcedWrapUp?: boolean;
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines].join("\n");
}

function buildRegulationSection(context: PromptBuildContext): string {
  const regulations = matchRegulations({
    activeSnailName: context.activeSnail?.name,
    stageType: context.stage.type,
    conversationKind: context.conversation.kind,
    repoRelated: isRepoRelated(context),
  }, listRegulations());
  const expandScriptPath = getRegulationExpandScriptPath();

  if (!regulations.length) {
    return section("通用规约披露", [
      "- 当前角色与场景未命中额外通用规约全文。",
      `- 如需按 id 查看任一规约全文，可执行: ${expandScriptPath} --id <regulation-id> --format markdown`,
    ]);
  }

  const lines = [
    "- 当前只固定注入命中规约的 policy；guidance、示例与补充说明不直接注入当前上下文。",
    ...regulations.map((regulation) => `- 命中规约: ${regulation.id} | ${regulation.title} | ${regulation.summary}`),
    `- 如需读取某条命中规约的完整 guidance，可执行: ${expandScriptPath} --id <regulation-id> --format markdown`,
    "",
  ];

  for (const regulation of regulations) {
    lines.push(`### ${regulation.title} (${regulation.id})`);
    lines.push(...buildCoreSectionLines("Policy", regulation.policy));
    lines.push("");
  }

  return section("通用规约披露", lines);
}

function buildCoreSectionLines(title: string, items: string[]): string[] {
  if (!items.length) {
    return [];
  }

  return [`${title}:`, ...items.map((item) => `- ${item}`)];
}

function isRepoRelated(context: PromptBuildContext): boolean {
  return ["coding", "check"].includes(context.stage.type);
}

function buildProjectSection(context: PromptBuildContext): string {
  return renderSection("SYS-CONV-PROJECT", buildTemplateVariables(context));
}

function buildStageSection(context: PromptBuildContext): string {
  return renderSection("SYS-CONV-STAGE", buildTemplateVariables(context));
}

function buildSnailSection(context: PromptBuildContext): string {
  return renderSection("SYS-CONV-SNAIL", buildTemplateVariables(context));
}

function buildConversationSection(context: PromptBuildContext): string {
  return renderSection("SYS-CONV-CONVERSATION", buildTemplateVariables(context));
}

function buildHistoryAccessSection(context: PromptBuildContext): string {
  return renderSection("SYS-CONV-HISTORY", buildTemplateVariables(context));
}

function buildRuntimeAdapterSection(context: PromptBuildContext): string | null {
  if (context.activeSnail?.runtime !== "claude-code-cli") {
    return null;
  }

  return renderSection("SYS-CONV-RUNTIME-CLAUDE", buildTemplateVariables(context));
}

export function buildConversationSystemPrompt(context: PromptBuildContext): string {
  const assembly = getAssembly("conversation.system");
  const runtimeAdapterSection = buildRuntimeAdapterSection(context);
  const variables = buildTemplateVariables(context);
  const intro = renderSection("SYS-CONV-INTRO", variables);
  const global = renderSection("SYS-CONV-GLOBAL", variables);
  const outro = renderSection("SYS-CONV-OUTRO", variables);
  const skillSection = buildSkillReferenceSection(assembly.skills ?? []);
  return [
    intro,
    "",
    global,
    "",
    buildRegulationSection(context),
    "",
    buildProjectSection(context),
    "",
    buildStageSection(context),
    "",
    buildSnailSection(context),
    "",
    buildConversationSection(context),
    "",
    buildHistoryAccessSection(context),
    ...(runtimeAdapterSection ? ["", runtimeAdapterSection] : []),
    "",
    skillSection,
    "",
    outro,
  ].join("\n");
}

function renderSection(assetId: string, variables: Record<string, string>): string {
  return renderTemplate(getSystemPromptAsset(assetId).content, variables).trim();
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
    stage_output_summary: context.stageDefinition.output.summary,
    stage_required_artifacts: context.stageDefinition.output.required_artifacts.join(", ") || "无",
    stage_artifact_requirements_block: context.stageDefinition.output.artifact_requirements.map((item) => `- 产物要求: ${item}`).join("\n"),
    stage_acceptance_focus_block: context.stageDefinition.acceptance_focus.map((item) => `- 验收关注点: ${item}`).join("\n"),
  };
}

function buildSnailVariables(context: PromptBuildContext): Record<string, string> {
  const activeSnail = context.activeSnail;
  const activePrompt = activeSnail ? getSystemPromptAsset(activeSnail.system_prompt.asset_id) : null;
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

function buildSkillReferenceSection(skills: Array<{ id: string; mode: "required" | "conditional"; reason: string }>): string {
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
