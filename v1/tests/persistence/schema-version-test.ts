import { getSchemaVersion } from "../../src/persistence/schema";
import fs from "fs";
import path from "path";
import os from "os";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const originalCwd = process.cwd();

try {
  // 1. must not throw to caller (worktree CWD is a valid git repo)
  let threw = false;
  try {
    getSchemaVersion();
  } catch {
    threw = true;
  }
  assert(!threw, "getSchemaVersion 不得向启动流程抛错");

  // 2. normal path: worktree has src/persistence/schema.ts in git history
  const version = getSchemaVersion();
  assert(
    /^[0-9a-f]{7,12} \d{4}-\d{2}-\d{2}$/.test(version),
    `正常路径应返回 "short_hash YYYY-MM-DD" 格式，实际: "${version}"`,
  );

  // 3. no git repo → "UNKNOWN"
  // 保存并清空 GIT_DIR/GIT_WORK_TREE，否则 git hooks 注入的环境变量会
  // 让 execSync 无视 cwd 直接使用 hook 指定的 git 仓库。
  const savedGitDir = process.env.GIT_DIR;
  const savedGitWorkTree = process.env.GIT_WORK_TREE;
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;

  try {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-version-no-git-"));
    process.chdir(nonGitDir);
    const noGitVersion = getSchemaVersion();
    assert(
      noGitVersion === "UNKNOWN",
      `无 git 环境应 fallback 为 "UNKNOWN"，实际: "${noGitVersion}"`,
    );
    process.chdir(originalCwd);
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  } finally {
    if (savedGitDir !== undefined) process.env.GIT_DIR = savedGitDir;
    if (savedGitWorkTree !== undefined) process.env.GIT_WORK_TREE = savedGitWorkTree;
  }
} finally {
  process.chdir(originalCwd);
}

console.log("schema version tests passed");
