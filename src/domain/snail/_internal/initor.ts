import type { FileSystem } from "@infra/file-system";
import { FileSnailRepository } from "./repository";
import { SnailAdapter } from "./adapter";

/** 初始化 Snail 模块 */
export function init(fs: FileSystem, repoRoot: string) {
  const repo = new FileSnailRepository(fs, repoRoot);
  const adapter = new SnailAdapter(repo);
  return { repo, adapter };
}
