import fs from "fs";
import path from "path";
import type { StageDefinition } from "../meta";
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
    `- 当前响应 Snail: ${active?.name ?? context.conversation.default_snail}`,
    `- 当前默认主 Snail: ${defaultSnail?.name ?? context.conversation.default_snail}`,
    `- 当前参与 Snails: ${context.participatingSnails.map((item) => item.name).join("、") || "无"}`,
    `- 当前剩余协作轮次: ${context.remainingCollaborationRounds ?? 0}`,
    `- 当前是否允许继续 @ 其他 Snail: ${context.mentionAllowed === false ? "否" : "是"}`,
    "- 如需让其他 Snail 或老大继续处理，只能使用该 Snail 的唯一 name 进行 @，格式为 @<Snail Name>。",
    "- 自然语言中的 snail 标识与系统内部标识完全一致：只认唯一 snail name，不认别名、中文角色称呼或展示名。",
    "- 系统会把消息中的所有有效 @<Snail Name> 识别为 mention，并分别投递给对应的 Snail。",
    "- 如果当前不允许继续扩散 mention，或者你处于最终收口阶段，则必须直接给出结论，不能再继续 @ 其他 Snail。",
  ];

  if (context.forcedWrapUp) {
    lines.push("- 当前处于最终收口阶段: 你必须直接整合已有讨论并给出结论，不允许再继续 mention 其他 Snail");
  }

  if (active) {
    lines.push(`- 当前 Snail 身份: ${active.system_prompt.identity}`);
    lines.push(...active.system_prompt.principles.map((item) => `- 当前 Snail 原则: ${item}`));
    lines.push(...active.working_rules.map((item) => `- 当前 Snail 工作规则: ${item}`));
    lines.push(`- 当前 Snail 偏好产物: ${active.preferred_artifact_types.join(", ") || "无"}`);
    lines.push(...active.system_prompt.output_expectations.map((item) => `- 当前 Snail 输出要求: ${item}`));
  }

  lines.push(...context.participatingSnails.map((snail) => `- 参与 Snail 角色: ${snail.name} | ${snail.description}`));

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

function buildHistoryAccessSection(context: PromptBuildContext): string {
  const historyScriptPath = path.join(process.cwd(), ".meta", "scripts", "conversation-history");
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "snail-shell.db");
  return section("历史上下文规则", [
    "- 默认只会向你提供当前 Conversation 摘要与最近少量消息，不会自动注入完整历史。",
    "- 如果你需要确认更早的需求、约束、决定、术语定义、用户偏好或先前结论，必须查询历史记录，不能在不确定时直接假设。",
    `- 可执行脚本: ${historyScriptPath}`,
    `- 当前数据库路径: ${dbPath}`,
    "- 脚本必须显式传入 --conversation-id，值就是当前 Conversation ID。",
    "- 常用模式: --mode search | page | recent | by-ids | window | reindex。",
    `- 当前 Conversation ID: ${context.conversation.id}`,
    `- 搜索示例: ${historyScriptPath} --mode search --db-path "${dbPath}" --conversation-id ${context.conversation.id} --query "关键词" --limit 5`,
    `- 查看前后文示例: ${historyScriptPath} --mode window --db-path "${dbPath}" --conversation-id ${context.conversation.id} --anchor-message-id 123 --before 2 --after 2`,
    `- 按 message id 拉原文示例: ${historyScriptPath} --mode by-ids --db-path "${dbPath}" --conversation-id ${context.conversation.id} --message-ids 123,124`,
    "- recent 的 --limit 表示最近 N 次用户发言对应的完整对话窗口，不是最近 N 条 message。",
    "- recent: USE WHEN 你要查看最近几轮完整互动窗口、处理刚刚发生的多轮承接、确认最近用户补充或修正。 NOT FOR 查找较早历史事实、定位“最早提到/之前定义/更早结论”这类问题的第一步。",
    "- search: USE WHEN 你要先定位某个历史事实、约束、决定、术语、偏好或用户之前提过的内容。 NOT FOR 顺序浏览整段历史；它是第一步定位工具，不是全文阅读工具。",
    "- window: USE WHEN 你已经有命中的 message_id，且需要查看该命中前后少量上下文。 NOT FOR 在没有命中点时盲目扩大阅读范围。",
    "- by-ids: USE WHEN 你已经知道具体 message_id，且需要精确原文。 NOT FOR 模糊搜索、也 NOT FOR 在不需要原文引用时替代 search。",
    "- page: USE WHEN 你必须按时间顺序浏览对话，例如查看开头、按 offset 翻页、或顺着时间线回看。 NOT FOR 关键词定位问题。",
    "- reindex: USE WHEN 你怀疑历史索引缺失或 search 异常。 NOT FOR 正常问答流程。",
    "- 选择工具时，按问题类型匹配最合适的模式；不要把 recent、search、page、window、by-ids 混成同一种用途。",
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
    buildHistoryAccessSection(context),
    "",
    "请严格按照以上分层上下文工作。",
  ].join("\n");
}
