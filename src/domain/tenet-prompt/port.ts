import type { PromptDocument } from "./model";

/** TenetPrompt 端口定义 */
export interface TenetPrompt {
  /** 列出所有已加载的 prompt 文档 */
  list(): PromptDocument[];

  /** 按 id 查找 */
  findById(id: string): PromptDocument | undefined;

  /** 按条件过滤匹配的 prompts */
  filter(match: {
    runtime?: string;
    stage_type?: string;
    role?: string;
    conversation_kind?: string;
  }): PromptDocument[];
}
