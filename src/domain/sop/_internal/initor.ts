import type { FileSystem } from "@infra/file-system";
import { FileSopRepository } from "./repository";
import { SopAdapter } from "./adapter";

/** 初始化 SOP 模块 */
export function init(fs: FileSystem, repoRoot: string, workspacePaths: string[]) {
  const repo = new FileSopRepository(fs, repoRoot, workspacePaths);
  const adapter = new SopAdapter(repo);
  return { repo, adapter };
}
