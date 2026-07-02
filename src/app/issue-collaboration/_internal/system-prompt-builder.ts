import type { MessageContext } from "@domain/message/model";
import type { MessagePort } from "@domain/message/port";
import type { SnailPort } from "@domain/snail/port";
import type { StagePort } from "@domain/issue/port";
import type { Issue, Stage } from "@domain/issue/model";
import type { RoleDefinition } from "@domain/sop/model";
import { buildIdentityBlock } from "@app/issue-collaboration/_internal/identity-block";
import { buildStageHistoryBlock } from "@app/issue-collaboration/_internal/stage-history-block";
import { resolveContextValue } from "@app/issue-collaboration/resource-cleanup";

export interface SystemPromptBuilderDeps {
  messagePort: MessagePort;
  snailPort: Pick<SnailPort, "findByKey">;
  stagePort: StagePort;
}

/** 检测 format=blocks JSON payload，提取 fallback_text；非 blocks 格式返回 null */
function extractBlocksFallback(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { format?: unknown; fallback_text?: unknown };
    if (parsed?.format === "blocks" && typeof parsed.fallback_text === "string" && parsed.fallback_text.trim()) return parsed.fallback_text;
  } catch { /* 非 JSON，正常回退 */ }
  return null;
}

/**
 * 系统提示构建器：构建 system reminder 和 context block。
 * 纯文本拼接，零副作用。
 */
export class SystemPromptBuilder {
  constructor(private readonly deps: SystemPromptBuilderDeps) {}

  buildSystemReminder(input: { issue: Issue; stage: Stage; roleInstance: string; roleKey: string; snailKey: string }): string {
    const { issue, stage, roleInstance, roleKey, snailKey } = input;
    const stageDef = issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key);
    const roleDef = stageDef?.roles.find(r => r.key === roleKey);
    return [buildIdentityBlock(roleDef?.name ?? roleInstance, roleInstance, roleDef, this.deps.snailPort.findByKey(snailKey)), this.buildContextBlock(issue, stage, roleDef, roleInstance)].join("\n\n");
  }

  extractTerminalContext(messageId: number, status: "completed" | "interrupted" | "failed", reason?: string): MessageContext {
    const existing = this.deps.messagePort.getContext(messageId);
    if (existing?.kind === "mcp_final_body") return existing;
    const events = this.deps.messagePort.getMessageEvents(messageId);
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.payload.type === "text" && event.payload.text.trim()) {
        /** 检测 format=blocks JSON payload，提取 fallback_text 避免原文泄露 */
        const blocksText = extractBlocksFallback(event.payload.text);
        return { message_id: messageId, kind: "final_text", context: blocksText ?? event.payload.text, created_at: new Date().toISOString() };
      }
    }
    /** 无 text event 也无 mcp_final_body 时返回状态对应的兜底文案，不 dump 原始 event 给用户 */
    const fallback = status === "interrupted"
      ? (reason ? `用户中断了本次回复（${reason}）` : "用户中断了本次回复")
      : status === "failed"
        ? (reason ? `任务执行失败（${reason}）` : "任务执行失败")
        : "（无文本输出）";
    return { message_id: messageId, kind: "event_summary", context: fallback, created_at: new Date().toISOString() };
  }

  private buildContextBlock(issue: Issue, stage: Stage, roleDef: RoleDefinition | undefined, roleInstance: string): string {
    const transitions = stage.available_transitions.map(transition => `- ${transition.to}${transition.guard ? `: ${transition.guard}` : ""}`).join("\n");
    const sharedSkill = issue.sop_snapshot.shared_skill;
    const skillList = [
      sharedSkill ? `- \`${sharedSkill}\` — 共享规则（特性编号、PR签名、证据规则、完成标准）` : null,
      roleDef?.skill ? `- \`${roleDef.skill}\` — ${roleDef.name}工作流程` : null,
    ].filter(Boolean).join("\n");
    /** Issue 上下文：只读视图，Agent 应使用 MCP 工具读写。基础设施字段缺失时标注警告 */
    const missingInfra = (issue.sop_snapshot.stage_definitions.find(d => d.key === stage.key)?.auto_advance?.required_context_fields ?? []).filter(f => !resolveContextValue(issue.context, f));
    const ctxLines = Object.entries(issue.context).map(([k, v]) => `- **${k}**: ${v}`).join("\n") || "无";
    const issueContext = missingInfra.length > 0 ? `${ctxLines}\n> ⚠️ 以下基础设施字段未记录：${missingInfra.join(", ")}` : ctxLines;
    /** 阶段历史：通过 from_stage_id 回溯构建链路，展示前序阶段的最近消息 */
    const stageHistory = buildStageHistoryBlock(this.deps.stagePort, this.deps.messagePort, stage);
    return `<context>
## 项目上下文
**Issue**：${issue.title}
**Issue ID**：${issue.id} | **工作区**：${issue.workspace_path}
**Issue 摘要**：${issue.summary ?? "无"}
## Issue 上下文（只读视图）
${issueContext}
> **注意**：这是只读视图。Agent 应使用 MCP 工具 \`set_context\` 和 \`get_context\` 读写 Issue 上下文。Issue 上下文也会通过环境变量 \`SNAIL_CTX_*\` 注入，可通过 \`process.env\` 读取。
${stageHistory}
## 当前阶段
**阶段**：${stage.title} (${stage.key}) — ${stage.description}
## 可用 Skills
${skillList}
使用 skill tool 触发对应的 skill，获取详细工作流程和规则。
## 可用流转
${transitions || "无"}
## 协作规则
- 你可以通过 @角色实例 请求其他角色回应
- 你是当前阶段的守门人，不是推进者。建议 stage_transition 前，必须先完成所在 SKILL.md 中的 Stage Gate 自检并呈现完整证据。
- 通过信号表达阶段工作结果：signal_type: gate_complete（单人完成）、adversarial_consensus（多人共识）、disagreement（分歧）
## 最终答复规则
**必须使用 \`set_final_body\` MCP 设置最终答复**。每次发言结束前必须调用此工具，传入你希望展示给用户的完整 Markdown 内容。调用后本轮发言结束，不得再调用任何其他工具。
**路由目标声明**：如果需要其他角色继续处理，必须在 \`set_final_body\` 的 \`to_speakers\` 参数中声明目标角色。
**可用路由目标**：${["user", ...stage.role_instances.filter(i => i !== roleInstance)].map(t => `\`${t}\``).join("、")}
**格式要求**：必须使用上述精确名称。不要使用 snail key、role key 或英文翻译。
**必选参数**：调用 \`set_final_body\` 前必须先调用 \`get_current_message_id\` 获取 \`message_id\`；\`stage_id\` 从环境变量 \`SNAIL_CTX_STAGE_ID\` 获取。
</context>`;
  }
}
