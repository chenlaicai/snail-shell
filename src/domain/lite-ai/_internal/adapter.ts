import type {
  ChatMessage,
  ChatOptions,
  MentionExtractionResult,
  ConversationSummaryInput,
  MessageContextSummaryInput,
  LlmConfig,
} from "@domain/lite-ai/model";
import type { LiteAIPort } from "@domain/lite-ai/port";
import type { LiteAIRepository } from "./repository";
import { OpenAIClient } from "./openai-client";

/**
 * Lite AI 适配器实现。
 * 实现业务逻辑，调用 OpenAI API 完成任务。
 */
export class LiteAIAdapter implements LiteAIPort {
  private client: OpenAIClient | null = null;

  constructor(private repo: LiteAIRepository) {
    const config = repo.getConfig();
    if (config) {
      this.client = new OpenAIClient(config.openai);
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    if (!this.client) {
      throw new Error("Lite AI not configured");
    }
    return this.client.chat(messages, options);
  }

  async extractMentions(
    messageText: string,
    participatingRoles: Array<{ name: string }>,
  ): Promise<MentionExtractionResult> {
    if (!this.client) {
      return { mentions: [] };
    }

    const roleNames = participatingRoles.map((r) => r.name).join("、");

    const systemPrompt = `你是一个消息分析助手。从用户消息中提取 @mention。

规则：
- @ 指向候选角色 → 视为 mention
- 请求角色参与/确认/审查/响应/处理 → 视为 mention
- 直接分配任务给角色 → 视为 mention
- 自我介绍、职责描述、历史回顾、纯事实陈述 → 不视为 mention
- 仅输出候选列表中精确匹配的角色

候选角色列表：${roleNames}

严格 JSON 输出：{"mentions":[{"role":"...","raw":"..."}]} 或 {"mentions":[]}`;

    const userPrompt = `分析以下消息中的 @mention：

${messageText}`;

    try {
      const response = await this.client.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.2 },
      );

      return this.parseMentionResult(response, participatingRoles);
    } catch {
      return { mentions: [] };
    }
  }

  async generateConversationSummary(input: ConversationSummaryInput): Promise<string> {
    if (!this.client) {
      return "";
    }

    const messagesText = input.messages
      .map((m) => `[${m.role}]: ${m.content.slice(0, 400)}`)
      .join("\n");

    const systemPrompt = `你是一个对话摘要助手。生成简洁的中文对话摘要。

要求：
- 220-320 中文字符，最多 400
- 格式：## 会话概览（最多 2 句）+ ## 当前进展（当前状态 + 后续动作）
- 保留：目标、约束、已确认决策、关键冲突、未解决问题、下一步
- 禁止：逐字引用消息、流水账`;

    const userPrompt = `会话标题：${input.title}
会话类型：${input.kind}
${input.previous_summary ? `已有摘要：${input.previous_summary}` : ""}

最近消息：
${messagesText}`;

    try {
      return await this.client.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.2 },
      );
    } catch {
      return "";
    }
  }

  async generateMessageContextSummary(input: MessageContextSummaryInput): Promise<string> {
    if (!this.client) {
      return "";
    }

    const systemPrompt = `你是一个上下文压缩助手。将长文本压缩为指定长度的中文摘要。

要求：
- 目标字符数：${input.target_chars}
- 保留：用户指令、结论、失败原因、关键文件/命令/artifact 引用
- 删除：冗余日志、重复文本、无关过程`;

    try {
      return await this.client.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.context },
        ],
        { temperature: 0.2 },
      );
    } catch {
      return "";
    }
  }

  private parseMentionResult(
    response: string,
    participatingRoles: Array<{ name: string }>,
  ): MentionExtractionResult {
    try {
      const parsed = JSON.parse(response);
      const mentions = (parsed.mentions || [])
        .filter((m: { role?: string; raw?: string }) => m.role && m.raw)
        .filter((m: { role: string }) =>
          participatingRoles.some((r) => r.name === m.role),
        )
        .map((m: { role: string; raw: string }) => ({
          role: m.role,
          raw: m.raw,
        }));

      return { mentions };
    } catch {
      return { mentions: [] };
    }
  }
}

/** 初始化 Lite AI 模块 */
export function init(fs: import("@infra/file-system").FileSystem, repoRoot: string) {
  const { FileLiteAIRepository } = require("./repository");
  const repo = new FileLiteAIRepository(fs, repoRoot);
  const adapter = new LiteAIAdapter(repo);
  return { repo, adapter };
}
