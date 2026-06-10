import type { FileSystem } from "@infra/file-system";
import { FileTenetPromptRepository } from "./repository";
import { TenetPromptAdapter } from "./adapter";

/** 初始化 TenetPrompt 模块 */
export function init(fs: FileSystem, repoRoot: string, workspacePaths: string[]) {
  const repo = new FileTenetPromptRepository(fs, repoRoot, workspacePaths);
  const adapter = new TenetPromptAdapter(repo);
  return { repo, adapter };
}
