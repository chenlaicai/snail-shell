import type { Workspace } from "@domain/workspace/model";
import type { PromptDocument } from "@domain/tenet-prompt/model";

/** TenetPrompt 端口定义 */
export interface TenetPromptPort {
  /** 页面展示用，列出所有 prompts */
  list(): PromptDocument[];

  /** 获取指定 workspace 的 prompts（平台 + 该 workspace），返回无 tag 和命中 tag 的 */
  findByWorkspace(workspace: Workspace, tags?: string[]): PromptDocument[];
}
