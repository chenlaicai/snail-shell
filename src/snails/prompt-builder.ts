import fs from "fs";
import path from "path";
import { StageDefinition } from "../meta";
import { Conversation, Project, Stage } from "../persistence/store";
import { SnailDefinition } from "./registry";

export interface PromptBuildContext {
  project: Project;
  stage: Stage;
  conversation: Conversation;
  stageDefinition: StageDefinition;
  activeSnail?: SnailDefinition;
  defaultSnail?: SnailDefinition;
  participatingSnails: SnailDefinition[];
  remainingCollaborationTurns?: number;
  handoffAllowed?: boolean;
  forcedWrapUp?: boolean;
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines].join("\n");
}

function buildSystemSection(): string {
  const skillsDir = path.join(process.cwd(), ".meta", "skills");
  const skills = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir)
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => fs.readFileSync(path.join(skillsDir, name), "utf8"))
    : [];

  // TODO: 这里当前先把 .meta/skills 下的 skill 临时并入 system 层。
  // 后续应改为：按 stage/snail/condition 精准筛选，仅在满足条件时才注入对应 skill。
  return section("Snail Shell 全局要求", [
    "- 工作必须留痕",
    "- 输出必须服务于 artifact 沉淀",
    "- 当前工作必须遵守 project / stage / conversation 的结构边界",
    ...(skills.length ? ["", ...skills] : []),
  ]);
}

function buildProjectSection(context: PromptBuildContext): string {
  return section("Project 上下文", [
    `- 当前 Project: ${context.project.name}`,
    `- Project 摘要: ${context.project.summary ?? "无"}`,
  ]);
}

function buildStageSection(context: PromptBuildContext): string {
  return section("Stage 上下文", [
    `- 当前 Stage: ${context.stageDefinition.title}`,
    `- 当前 Stage 输入: ${context.stageDefinition.input.join(", ") || "无"}`,
    `- 当前 Stage 输出摘要: ${context.stageDefinition.output.summary}`,
    `- 当前 Stage 正式交付要求: ${context.stageDefinition.output.required_artifacts.join(", ") || "无"}`,
    ...context.stageDefinition.output.artifact_requirements.map((item) => `- 产物要求: ${item}`),
    ...context.stageDefinition.acceptance_focus.map((item) => `- 验收关注点: ${item}`),
  ]);
}

function buildSnailSection(context: PromptBuildContext): string {
  const active = context.activeSnail;
  const defaultSnail = context.defaultSnail;
  const lines = [
    `- 当前响应 Snail: ${active?.title ?? context.conversation.default_snail}`,
    `- 当前默认主 Snail: ${defaultSnail?.title ?? context.conversation.default_snail}`,
    `- 当前参与 Snails: ${context.participatingSnails.map((item) => item.title).join("、") || "无"}`,
    `- 当前剩余协作轮数: ${context.remainingCollaborationTurns ?? 0}`,
    `- 当前是否允许转交其他 Snail: ${context.handoffAllowed === false ? "否" : "是"}`,
    "- 当你判断需要其他 Snail 继续处理时，可以在回复中使用 @<Snail 展示名> 发起转交协作。",
    "- 每次最多只转交给一个 Snail，系统只会识别第一个有效 @<Snail 展示名>。",
    "- 如果当前不允许转交其他 Snail，或者你处于最终收口阶段，则必须直接给出结论，不能再使用 @ 转交。",
  ];

  if (context.forcedWrapUp) {
    lines.push("- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再 @ 其他 Snail");
  }

  if (active) {
    lines.push(`- 当前 Snail 身份: ${active.system_prompt.identity}`);
    lines.push(...active.system_prompt.principles.map((item) => `- 当前 Snail 原则: ${item}`));
    lines.push(...active.working_rules.map((item) => `- 当前 Snail 工作规则: ${item}`));
    lines.push(`- 当前 Snail 偏好产物: ${active.preferred_artifact_types.join(", ") || "无"}`);
    lines.push(...active.system_prompt.output_expectations.map((item) => `- 当前 Snail 输出要求: ${item}`));
  }

  lines.push(...context.participatingSnails.map((snail) => `- 参与 Snail 角色: ${snail.title} | ${snail.description}`));

  return section("Snail 上下文", lines);
}

function buildConversationSection(context: PromptBuildContext): string {
  return section("Conversation 上下文", [
    `- 当前 Conversation 标题: ${context.conversation.title}`,
    `- 当前 Conversation 类型: ${context.conversation.kind}`,
    `- 当前 Conversation 来源: ${context.conversation.from_conversation_ids.join(", ") || "无"}`,
    `- 当前 Conversation 摘要: ${context.conversation.summary ?? "无"}`,
  ]);
}

export function buildConversationSystemPrompt(context: PromptBuildContext): string {
  return [
    "你正在 Snail Shell 工作室中工作。",
    "",
    buildSystemSection(),
    "",
    buildProjectSection(context),
    "",
    buildStageSection(context),
    "",
    buildSnailSection(context),
    "",
    buildConversationSection(context),
    "",
    "请严格按照以上分层上下文工作。",
  ].join("\n");
}
