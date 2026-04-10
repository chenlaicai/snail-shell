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
    `- 搜索示例: ${historyScriptPath} --mode search --db-path \"${dbPath}\" --conversation-id ${context.conversation.id} --query \"关键词\" --limit 5`,
    `- 查看前后文示例: ${historyScriptPath} --mode window --db-path \"${dbPath}\" --conversation-id ${context.conversation.id} --anchor-message-id 123 --before 2 --after 2`,
    `- 按 message id 拉原文示例: ${historyScriptPath} --mode by-ids --db-path \"${dbPath}\" --conversation-id ${context.conversation.id} --message-ids 123,124`,
    "- 推荐工作流: 先用 search 定位相关 message_id，再用 window 查看命中消息前后文；只有在需要精确原文时才使用 by-ids。",
    "- 当用户提到“之前说过 / 前面讨论过 / 延续上次 / 沿用之前”时，应优先执行 search，而不是直接回答。",
    "- 当摘要与最近消息不足以支持高置信回答时，应先 search；若搜索命中，再用 window 或 by-ids 获取最小必要原文。",
    "- recent 适合快速查看最近窗口，page 适合顺序翻阅历史，reindex 只在怀疑索引缺失或历史搜索异常时使用。",
    "- 注意: recent 的 --limit 表示最近 N 次用户发言对应的完整对话窗口，不是最近 N 条 message。",
    "- 每次只获取完成当前任务所需的最小历史范围，避免一次读取过多历史；默认 limit 建议不超过 5。",
    "- 如果 search 已经足够确认信息，就不要继续拉取更多正文。",
    "- 如果当前摘要与最近消息已经足够支撑高置信回答，则不要额外查询历史。",
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
