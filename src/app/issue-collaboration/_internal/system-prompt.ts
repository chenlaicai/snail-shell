import type { Issue, Stage } from "@domain/issue/model";
import type { RoleDefinition } from "@domain/sop/model";
import type { SnailPort } from "@domain/snail/port";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";
import { buildIdentityBlock } from "@app/issue-collaboration/_internal/identity-block";

export function buildSystemReminder(input: {
  issue: Issue; stage: Stage; roleInstance: string; roleKey: string; snailKey: string;
  snailPort: SnailPort;
}): string {
  const { issue, stage, roleInstance, roleKey, snailKey, snailPort } = input;
  const stageDef = issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key);
  const roleDef = stageDef?.roles.find(r => r.key === roleKey);
  return [
    buildIdentityBlock(roleDef?.name ?? roleInstance, roleInstance, roleDef, snailPort.findByKey(snailKey)),
    buildContextBlock(issue, stage, roleDef, roleInstance),
  ].join("\n\n");
}

function buildContextBlock(issue: Issue, stage: Stage, roleDef: RoleDefinition | undefined, roleInstance: string): string {
  const transitions = stage.available_transitions.map(t => `- ${t.to}${t.guard ? `: ${t.guard}` : ""}`).join("\n");
  const skillList = [
    issue.sop_snapshot.shared_skill ? `- \`${issue.sop_snapshot.shared_skill}\` — 共享规则（特性编号、PR签名、证据规则、完成标准）` : null,
    roleDef?.skill ? `- \`${roleDef.skill}\` — ${roleDef.name}工作流程` : null,
  ].filter(Boolean).join("\n");
  const missingInfra = ["worktree_path", "branch_name"].filter(f => !resolveContextValue(issue.context, f));
  const ctxLines = Object.entries(issue.context).map(([k, v]) => `- **${k}**: ${v}`).join("\n") || "无";
  const issueContext = missingInfra.length > 0 ? `${ctxLines}\n> ⚠️ 以下基础设施字段未记录：${missingInfra.join(", ")}` : ctxLines;
  const targets = ["user", ...stage.role_instances.filter(i => i !== roleInstance)].map(t => `\`${t}\``).join("、");
  return [
    "<context>",
    "## 项目上下文",
    `**Issue**：${issue.title}`,
    `**Issue ID**：${issue.id}`,
    `**工作区**：${issue.workspace_path}`,
    `**Issue 摘要**：${issue.summary ?? "无"}`,
    "## Issue 上下文（只读视图）",
    issueContext,
    "> **注意**：这是只读视图。Agent 应使用 MCP 工具 `set_context` 和 `get_context` 读写 Issue 上下文。Issue 上下文也会通过环境变量 `SNAIL_CTX_*` 注入，可通过 `process.env` 读取。",
    "## 当前阶段",
    `**阶段**：${stage.title} (${stage.key})`,
    `**阶段描述**：${stage.description}`,
    "## 可用 Skills",
    skillList,
    "使用 skill tool 触发对应的 skill，获取详细工作流程和规则。",
    "## 可用流转",
    transitions || "无",
    "## 协作规则",
    "- 你可以通过 @角色实例 请求其他角色回应",
    "- 你是当前阶段的守门人，不是推进者。建议 stage_transition 前，必须先完成所在 SKILL.md 中的 Stage Gate 自检并呈现完整证据。",
    "- 通过信号表达阶段工作结果：signal_type: gate_complete（单人完成）、adversarial_consensus（多人共识）、disagreement（分歧）",
    "## 最终答复规则",
    "**必须使用 `set_final_body` MCP 设置最终答复**。每次发言结束前必须调用此工具，传入你希望展示给用户的完整 Markdown 内容。调用后本轮发言结束，不得再调用任何其他工具。",
    "**路由目标声明**：如果需要其他角色继续处理，必须在 `set_final_body` 的 `to_speakers` 参数中声明目标角色。",
    `**可用路由目标**：${targets}`,
    "**格式要求**：必须使用上述精确名称。不要使用 snail key（如 claude-code-stateful）、role key（如 designer）或英文翻译（如 architect-1）。",
    "**必选参数**：调用 `set_final_body` 时必须传入 `message_id` 和 `stage_id`，从环境变量 `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_STAGE_ID` 获取。",
    "</context>",
  ].join("\n");
}
