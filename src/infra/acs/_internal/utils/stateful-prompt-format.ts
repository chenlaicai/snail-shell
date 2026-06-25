import type { Message } from "@infra/acs/model";

type MessageSectionTitle = "引用消息" | "新消息";

export interface StatefulPromptInput {
  systemPrompt?: string;
  systemReminder?: string;
  bootstrapMessages?: Message[];
  incrementalMessages?: Message[];
}

interface RenderStatefulPromptOptions {
  /** 跳过 systemPrompt 渲染（用于 Codex 等原生 developer_instructions 注入的运行时） */
  skipSystemPrompt?: boolean;
}

export function renderStatefulPrompt(input: StatefulPromptInput, options?: RenderStatefulPromptOptions): string {
  const parts: string[] = [];

  // systemPrompt（静态规则）优先注入，建立基础宪法
  if (input.systemPrompt && !options?.skipSystemPrompt) {
    parts.push(renderCurrentTaskContext(input.systemPrompt));
  }

  // systemReminder（动态运行时上下文）仅在变化时注入
  if (input.systemReminder) {
    parts.push(`<system-reminder>\n${input.systemReminder}\n</system-reminder>`);
  }

  if (input.bootstrapMessages) {
    parts.push(...input.bootstrapMessages.map((message) => renderMessageSection("引用消息", message)));
  }

  if (input.incrementalMessages) {
    parts.push(...input.incrementalMessages.map((message) => renderMessageSection("新消息", message)));
  }

  return parts.filter((part) => part.trim()).join("\n\n");
}

function renderCurrentTaskContext(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return `## 当前任务上下文\n\n${trimmed}`;
}

function renderMessageSection(title: MessageSectionTitle, message: Message): string {
  const content = message.content.trim();
  if (!content) return "";
  return [`## ${title}`, `${message.speaker}:`, "内容:", content].join("\n\n");
}
