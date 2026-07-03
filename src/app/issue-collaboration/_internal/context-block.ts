/**
 * buildContextBlock 的输入参数。
 * 所有字段由调用方从 Issue/Stage/RoleDefinition 中提取。
 */
export interface ContextBlockInput {
  issueTitle: string;
  issueId: string;
  workspacePath: string;
  issueSummary: string;
  issueContext: string;
  stageTitle: string;
  stageKey: string;
  stageDescription: string;
  skillList: string;
  transitions: string;
  targets: string;
}

/** 协作规则（静态文本） */
const RULES = [
  "- 你可以通过 @角色实例 请求其他角色回应",
  "- 你是当前阶段的守门人，不是推进者。建议 stage_transition 前，必须先完成所在 SKILL.md 中的 Stage Gate 自检并呈现完整证据。",
  "- 通过信号表达阶段工作结果：signal_type: gate_complete（单人完成）、adversarial_consensus（多人共识）、disagreement（分歧）",
].join("\n");

/**
 * 构建 <context> 块。
 *
 * 模板内容独立于 collaboration.ts，避免主文件行数膨胀。
 * 动态数据通过 ContextBlockInput 注入。
 */
export function buildContextBlock(input: ContextBlockInput): string {
  const { issueTitle, issueId, workspacePath, issueSummary, issueContext, stageTitle, stageKey, stageDescription, skillList, transitions, targets } = input;
  const finalRules = [
    `**必须使用 \`set_final_body\` MCP 设置最终答复**。每次发言结束前必须调用此工具，传入你希望展示给用户的完整 Markdown 内容。调用后本轮发言结束，不得再调用任何其他工具。`,
    `**路由目标声明**：如果需要其他角色继续处理，必须在 \`set_final_body\` 的 \`to_speakers\` 参数中声明目标角色。`,
    `**可用路由目标**：${targets}`,
    `**格式要求**：必须使用上述精确名称。不要使用 snail key、role key 或英文翻译。`,
    `**必选参数**：调用 \`set_final_body\` 前必须先调用 \`get_current_message_id\` 获取 \`message_id\`；\`stage_id\` 从环境变量 \`SNAIL_CTX_STAGE_ID\` 获取。`,
  ].join("\n");
  return `<context>
## 项目上下文
**Issue**：${issueTitle}
**Issue ID**：${issueId} | **工作区**：${workspacePath}
**Issue 摘要**：${issueSummary}
## Issue 上下文（只读视图）
${issueContext}
> **注意**：这是只读视图。Agent 应使用 MCP 工具 \`set_context\` 和 \`get_context\` 读写 Issue 上下文。Issue 上下文也会通过环境变量 \`SNAIL_CTX_*\` 注入，可通过 \`process.env\` 读取。
## 当前阶段
**阶段**：${stageTitle} (${stageKey}) — ${stageDescription}
## 可用 Skills
${skillList}
使用 skill tool 触发对应的 skill，获取详细工作流程和规则。
## 可用流转
${transitions || "无"}
## 协作规则
${RULES}
## 最终答复规则
${finalRules}
</context>`;
}
