import { getSchemaVersion } from "../../src/persistence/schema";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

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
// 用 GIT_DIR 指向不存在的目录来模拟无 git 环境。
// 注意：SERVER_ROOT 在模块加载时固定，process.chdir() 不再影响 execSync 的 cwd。
const savedGitDir = process.env.GIT_DIR;
const savedGitWorkTree = process.env.GIT_WORK_TREE;
process.env.GIT_DIR = "/nonexistent-git-dir";
process.env.GIT_WORK_TREE = "/nonexistent-git-worktree";

try {
  const noGitVersion = getSchemaVersion();
  assert(
    noGitVersion === "UNKNOWN",
    `无 git 环境应 fallback 为 "UNKNOWN"，实际: "${noGitVersion}"`,
  );
} finally {
  if (savedGitDir !== undefined) process.env.GIT_DIR = savedGitDir;
  else delete process.env.GIT_DIR;
  if (savedGitWorkTree !== undefined) process.env.GIT_WORK_TREE = savedGitWorkTree;
  else delete process.env.GIT_WORK_TREE;
}

console.log("schema version tests passed");
