import type { AgentMessage, StatefulInvocationInput } from "./interface";

type MessageSectionTitle = "引用消息" | "新消息";

export interface RenderStatefulPromptOptions {
  /** 跳过 systemPrompt 渲染（用于 Codex 等原生 developer_instructions 注入的运行时） */
  skipSystemPrompt?: boolean;
}

export function renderStatefulPrompt(input: StatefulInvocationInput, options?: RenderStatefulPromptOptions): string {
  const parts: string[] = [];

  // systemPrompt（静态规则）优先注入，建立基础宪法
  if (input.bootstrap && !options?.skipSystemPrompt) {
    parts.push(renderCurrentTaskContext(input.bootstrap.systemPrompt));
  }

  // systemReminder（动态运行时上下文）仅在变化时注入
  if (input.systemReminder) {
    parts.push(`<system-reminder>\n${input.systemReminder}\n</system-reminder>`);
  }

  if (input.bootstrap) {
    parts.push(...input.bootstrap.messages.map((message) => renderMessageSection("引用消息", message)));
  }

  parts.push(...input.incrementalMessages.map((message) => renderMessageSection("新消息", message)));
  return parts.filter((part) => part.trim()).join("\n\n");
}

function renderCurrentTaskContext(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  /**
   * Stateful CLI 只能接收单段 prompt，不能真正承载 system/developer 角色消息。
   * 这里明确表达为当前任务上下文，避免用 SYSTEM: 伪装成 transcript 边界，减少模型把规则误判为用户粘贴文本。
   */
  return `## 当前任务上下文\n\n${trimmed}`;
}

function renderMessageSection(title: MessageSectionTitle, message: AgentMessage): string {
  const content = message.content.trim();
  if (!content) return "";
  return [`## ${title}`, `角色: ${message.role}`, "内容:", content].join("\n\n");
}
