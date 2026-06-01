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

/**
 * output_artifacts.resources 数组中的单条资源记录。
 * 每条记录对应一个 role 创建的需要归档清理的仓库资源（worktree 或 branch）。
 * 永久保留的产物（如报告、交付物）不记入 resources，直接通过 --set 写入 output_artifacts 即可。
 */
export interface ResourceEntry {
  type: "worktree" | "branch";
  value: string;
  /** 创建该资源的角色名，仅用于审计追踪。 */
  by?: string;
}

const PROTECTED_BRANCHES = new Set(["main", "master"]);

/**
 * 遍历 Feature 所有 stage 的 output_artifacts，收集并清理全部记录的 worktree 和分支。
 *
 * 为什么遍历所有 stage 而非只看 active stage：一个 Feature 经历 development → review 等多个 stage，
 * 每个 stage 的每个 role 都可能创建独立的 worktree/branch。只清理 active stage 会导致前面所有 stage
 * 的资源被遗留。
 */
export function cleanupFeatureAllStages(
  stages: Stage[],
  options: RepoCleanupOptions = {},
): RepoCleanupResult {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const allResources = stages.flatMap((s) => collectResources(s.output_artifacts));

  const seenWorktrees = new Set<string>();
  const seenBranches = new Set<string>();
  const steps: RepoCleanupStep[] = [];

  for (const r of allResources) {
    if (r.type === "worktree") {
      if (seenWorktrees.has(r.value)) continue;
      seenWorktrees.add(r.value);
      steps.push(removeRecordedWorktree(r.value, repoRoot));
    } else if (r.type === "branch") {
      if (seenBranches.has(r.value)) continue;
      seenBranches.add(r.value);
      steps.push(deleteRecordedBranch(r.value, repoRoot));
    }
  }

  return {
    attempted: steps.some((step) => step.status !== "skipped"),
    steps,
  };
}

/**
 * 从单个 stage 的 output_artifacts 中提取资源列表。
 *
 * 支持两种格式：
 * - 新格式：`resources` 数组，每项包含 type/value/by
 * - 旧格式兼容：`worktree_path` 和 `branch_name` flat keys
 *
 * 两种格式可共存，collectResources 合并返回（调用方负责去重）。
 */
function collectResources(artifacts: Record<string, unknown>): ResourceEntry[] {
  const result: ResourceEntry[] = [];

  const resources = artifacts.resources;
  if (Array.isArray(resources)) {
    for (const r of resources) {
      const parsed = parseResourceEntry(r);
      if (parsed) result.push(parsed);
    }
  }

  pushFlatKeyResource(result, "worktree_path", "worktree", artifacts);
  pushFlatKeyResource(result, "branch_name", "branch", artifacts);

  return result;
}

function parseResourceEntry(raw: unknown): ResourceEntry | null {
  if (!raw || typeof raw !== "object" || typeof (raw as Record<string, unknown>).value !== "string") return null;
  const type = (raw as Record<string, unknown>).type;
  if (type !== "worktree" && type !== "branch") return null;
  const by = (raw as Record<string, unknown>).by;
  return { type, value: (raw as Record<string, unknown>).value as string, ...(typeof by === "string" ? { by } : {}) };
}

function pushFlatKeyResource(result: ResourceEntry[], key: string, type: "worktree" | "branch", artifacts: Record<string, unknown>): void {
  const value = artifacts[key];
  if (typeof value === "string" && value) result.push({ type, value });
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
