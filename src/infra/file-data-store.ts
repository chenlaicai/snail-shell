import path from "path";
import { FileLoader } from "./file-loader";

/**
 * 文件数据存储。
 *
 * 基于 FileLoader 的运行时数据访问层。
 * 目录结构由 infra 层管理：data/file/
 * 调用方只需传入 repoRoot，不需要知道数据目录在哪。
 *
 * 两个层级：
 *  - 平台级：data/file/ — 全局共享的运行时数据（workspaces.json, sops/ 等）
 *  - Workspace 级：<ws>/.snail/ — 每个工作区独立的数据（skills/, prompts/ 等）
 *
 * 用法：
 *   const store = FileDataStore.fromRepoRoot(repoRoot);
 *   store.readJson("workspaces.json");              // 读 data/file/workspaces.json
 *
 *   const wsStore = store.workspace("/path/to/ws");
 *   wsStore.readFile("skills/foo/SKILL.md");         // 读 <ws>/.snail/skills/foo/SKILL.md
 */
export class FileDataStore extends FileLoader {
  constructor(baseDir: string) {
    super(baseDir);
  }

  /** 从 repoRoot 创建平台级 FileDataStore（data/file/） */
  static fromRepoRoot(repoRoot: string): FileDataStore {
    return new FileDataStore(path.join(repoRoot, "data", "file"));
  }

  /** 创建 workspace 级 FileDataStore（<ws>/.snail/） */
  workspace(workspacePath: string): FileDataStore {
    return new FileDataStore(path.join(workspacePath, ".snail"));
  }
}
