import { existsSync, realpathSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { Stage } from "../persistence/store";

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

/** 清理时认领的 key → 资源类型映射。 */
const CLEANABLE_KEYS: Record<string, "worktree" | "branch"> = {
  worktree_path: "worktree",
  branch_name: "branch",
};

/**
 * 遍历 Feature 所有 stage 的 output_artifacts，清理 worktree_path 和 branch_name。
 *
 * 只清理 CLEANABLE_KEYS 中定义的 key；其他 key（如 pr_url、report_path）一概不碰。
 * output_artifacts.permanent_artifacts 列出的 key 即使在 CLEANABLE_KEYS 中也会跳过。
 * 跨 stage 去重，同一路径/分支只处理一次。
 */
export function cleanupFeatureAllStages(
  stages: Stage[],
  options: RepoCleanupOptions = {},
): RepoCleanupResult {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const seen = { worktrees: new Set<string>(), branches: new Set<string>() };
  const steps = stages.flatMap((s) => cleanupStage(s.output_artifacts, seen, repoRoot));
  return { attempted: steps.some((step) => step.status !== "skipped"), steps };
}

function cleanupStage(artifacts: Record<string, unknown>, seen: { worktrees: Set<string>; branches: Set<string> }, repoRoot: string): RepoCleanupStep[] {
  const permanent = getPermanentKeys(artifacts);
  const steps: RepoCleanupStep[] = [];

  for (const [key, targetType] of Object.entries(CLEANABLE_KEYS)) {
    if (permanent.has(key)) {
      steps.push({ target: targetType, value: null, status: "skipped", message: `${key} 标记为永久保留` });
      continue;
    }
    const value = artifacts[key];
    if (typeof value !== "string" || !value) continue;
    steps.push(cleanResource(targetType, value, seen, repoRoot));
  }
  return steps;
}

function cleanResource(targetType: "worktree" | "branch", value: string, seen: { worktrees: Set<string>; branches: Set<string> }, repoRoot: string): RepoCleanupStep {
  if (targetType === "worktree") {
    if (seen.worktrees.has(value)) return { target: "worktree", value, status: "skipped", message: "已处理" };
    seen.worktrees.add(value);
    return removeRecordedWorktree(value, repoRoot);
  }
  if (seen.branches.has(value)) return { target: "branch", value, status: "skipped", message: "已处理" };
  seen.branches.add(value);
  return deleteRecordedBranch(value, repoRoot);
}

function getPermanentKeys(artifacts: Record<string, unknown>): Set<string> {
  let raw = artifacts.permanent_artifacts;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return new Set(); }
  }
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((k): k is string => typeof k === "string"));
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
  const allowedRoots = Array.from(new Set([
    path.join(repoRoot, ".claude", "worktrees"),
    path.join(repoRoot, ".snail", "worktrees"),
  ])).map((item) => realpathIfExists(item) ?? item);
  const realCandidate = realpathIfExists(candidatePath) ?? candidatePath;
  const realRepoRoot = realpathIfExists(repoRoot) ?? repoRoot;

  if (realCandidate === realRepoRoot) {
    return "拒绝移除仓库主目录";
  }

  const insideAllowedRoot = allowedRoots.some((allowedRoot) => isPathInside(realCandidate, allowedRoot));
  return insideAllowedRoot ? null : "拒绝移除约定 worktree 目录之外的路径";
}

function validateBranchName(branchName: string, repoRoot: string): string | null {
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
