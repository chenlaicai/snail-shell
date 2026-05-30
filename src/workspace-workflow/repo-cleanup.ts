import { existsSync, realpathSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";

export interface RepoCleanupStep {
  target: "worktree" | "branch";
  value: string | null;
  status: "removed" | "skipped" | "failed";
  message: string;
}

export interface RepoCleanupResult {
  attempted: boolean;
  steps: RepoCleanupStep[];
}

interface RepoCleanupOptions {
  repoRoot?: string;
}

const PROTECTED_BRANCHES = new Set(["main", "master"]);

/**
 * 从 stage 的 output_artifacts Record 中读取 repo context 并清理 worktree 和分支。
 * output_artifacts 中的 key 约定：
 * - `branch_name`：工作分支名
 * - `worktree_path`：worktree 绝对路径
 * - `pr_url`：仅记录，不触发清理动作
 */
export function cleanupFeatureRepoContext(
  outputArtifacts: Record<string, string>,
  options: RepoCleanupOptions = {}
): RepoCleanupResult {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const steps: RepoCleanupStep[] = [];

  const worktreePath = outputArtifacts["worktree_path"];
  if (worktreePath) {
    steps.push(removeRecordedWorktree(worktreePath, repoRoot));
  } else {
    steps.push({ target: "worktree", value: null, status: "skipped", message: "Stage 未记录 worktree_path" });
  }

  const branchName = outputArtifacts["branch_name"];
  if (branchName) {
    steps.push(deleteRecordedBranch(branchName, repoRoot));
  } else {
    steps.push({ target: "branch", value: null, status: "skipped", message: "Stage 未记录 branch_name" });
  }

  return {
    attempted: steps.some((step) => step.status !== "skipped"),
    steps,
  };
}

function removeRecordedWorktree(worktreePath: string, repoRoot: string): RepoCleanupStep {
  const resolvedPath = path.resolve(worktreePath);
  const safetyError = validateWorktreePath(resolvedPath, repoRoot);
  if (safetyError) {
    return { target: "worktree", value: worktreePath, status: "failed", message: safetyError };
  }
  if (!existsSync(resolvedPath)) {
    return { target: "worktree", value: worktreePath, status: "skipped", message: "记录的 worktree 路径已不存在" };
  }

  const result = runGit(repoRoot, ["worktree", "remove", "--", resolvedPath]);
  return result.ok
    ? { target: "worktree", value: worktreePath, status: "removed", message: "已移除记录的 worktree" }
    : { target: "worktree", value: worktreePath, status: "failed", message: result.message };
}

function deleteRecordedBranch(branchName: string, repoRoot: string): RepoCleanupStep {
  const safetyError = validateBranchName(branchName, repoRoot);
  if (safetyError) {
    return { target: "branch", value: branchName, status: "failed", message: safetyError };
  }

  const exists = runGit(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`]);
  if (!exists.ok) {
    return { target: "branch", value: branchName, status: "skipped", message: "记录的本地分支已不存在" };
  }

  const result = runGit(repoRoot, ["branch", "-d", branchName]);
  return result.ok
    ? { target: "branch", value: branchName, status: "removed", message: "已删除合入后的本地分支" }
    : { target: "branch", value: branchName, status: "failed", message: result.message };
}

function validateWorktreePath(candidatePath: string, repoRoot: string): string | null {
  /**
   * 自动收尾会真实删除目录，因此只能允许 Snail Shell 明确约定的隔离 worktree 根目录。
   * 这个边界同时覆盖主仓库运行和测试/研发时从 sibling worktree 内运行两种场景，避免路径记录错误时误删主仓库或用户目录。
   */
  const allowedRoots = Array.from(new Set([
    path.join(repoRoot, ".claude", "worktrees"),
    path.resolve(repoRoot, "..", "snail-shell-worktrees"),
    ...currentWorktreeContainer(repoRoot),
  ])).map((item) => realpathIfExists(item) ?? item);
  const realCandidate = realpathIfExists(candidatePath) ?? candidatePath;
  const realRepoRoot = realpathIfExists(repoRoot) ?? repoRoot;

  if (realCandidate === realRepoRoot) {
    return "拒绝移除仓库主目录";
  }

  const insideAllowedRoot = allowedRoots.some((allowedRoot) => isPathInside(realCandidate, allowedRoot));
  return insideAllowedRoot ? null : "拒绝移除约定 worktree 目录之外的路径";
}

function currentWorktreeContainer(repoRoot: string): string[] {
  const parent = path.dirname(repoRoot);
  return path.basename(parent) === "snail-shell-worktrees" ? [parent] : [];
}

function validateBranchName(branchName: string, repoRoot: string): string | null {
  /**
   * 分支清理只删除本地普通分支，并依赖 `git branch -d` 保留 Git 对未合入分支的保护；
   * 这里先过滤主分支、远端引用和异常 ref 名，避免完成 Feature 的动作越权影响共享历史。
   */
  if (PROTECTED_BRANCHES.has(branchName)) {
    return "拒绝删除受保护主分支";
  }
  if (branchName.startsWith("origin/") || branchName.includes("..") || branchName.includes(" ") || branchName.trim() !== branchName) {
    return "拒绝删除不安全的分支名";
  }
  if (!runGit(repoRoot, ["check-ref-format", "--branch", branchName]).ok) {
    return "拒绝删除非法分支名";
  }
  return null;
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function realpathIfExists(candidatePath: string): string | null {
  try {
    return existsSync(candidatePath) ? realpathSync(candidatePath) : null;
  } catch {
    return null;
  }
}

function runGit(cwd: string, args: string[]): { ok: boolean; message: string } {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    ok: result.status === 0,
    message: output || (result.error ? result.error.message : `git ${args.join(" ")} exited with ${result.status}`),
  };
}
