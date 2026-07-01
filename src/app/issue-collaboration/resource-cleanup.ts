import { execFile } from "child_process";
import { realpathSync } from "fs";
import { getLogger } from "@infra/logger";

const log = getLogger({ module: "resource-cleanup" });

export type ResourceStatus = "success" | "failed" | "skipped";

export interface ResourceResult {
  status: ResourceStatus;
  error?: string;
}

export interface CleanupResult {
  pr: ResourceResult;
  worktree: ResourceResult;
  localBranch: ResourceResult;
  remoteBranch: ResourceResult;
}

const RESERVED_BRANCHES = new Set(["main", "master"]);

/**
 * 从 Issue context 中解析值（精确匹配）。
 * 调用方应使用完整的 stage-prefixed key（如 "design.worktree_path"）。
 */
export function resolveContextValue(context: Record<string, string>, key: string): string | undefined {
  const val = context[key]?.trim();
  return val || undefined;
}

/**
 * 校验分支名安全性。
 * 拒绝保留分支、origin/ 前缀；使用 git check-ref-format --branch 验证格式。
 */
export async function validateBranchName(name: string): Promise<{ valid: boolean; error?: string }> {
  if (RESERVED_BRANCHES.has(name)) return { valid: false, error: `拒绝删除保留分支: ${name}` };
  if (name.startsWith("origin/")) return { valid: false, error: `拒绝删除远端引用: ${name}` };
  const { exitCode } = await execCommand("git", ["check-ref-format", "--branch", name]);
  if (exitCode !== 0) return { valid: false, error: `分支名格式非法: ${name}` };
  return { valid: true };
}

/**
 * 校验 worktree 路径安全性。
 * 拒绝删除仓库主目录；只允许 .claude/worktrees/ 或 .snail/worktrees/ 下的路径。
 * 使用 realpathSync 处理 macOS /var → /private/var 符号链接。
 */
export function validateWorktreePath(worktreePath: string, workspacePath: string): { valid: boolean; error?: string } {
  try {
    const resolved = realpathSync(worktreePath);
    const resolvedWorkspace = realpathSync(workspacePath);
    if (resolved === resolvedWorkspace) return { valid: false, error: "拒绝删除仓库主目录" };
    const normalized = resolved.replace(/\\/g, "/");
    if (!normalized.includes("/.claude/worktrees/") && !normalized.includes("/.snail/worktrees/")) {
      return { valid: false, error: `路径不在允许的 worktree 白名单内: ${worktreePath}` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `路径解析失败: ${worktreePath}` };
  }
}

/**
 * Best-effort 清理 Issue 关联的 Git 资源和 PR。
 * 清理顺序：PR → worktree → 本地分支 → 远端分支。
 * 单个资源清理失败不阻断后续清理。
 */
export async function cleanupResources(
  context: Record<string, string>,
  workspacePath: string,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    pr: { status: "skipped" },
    worktree: { status: "skipped" },
    localBranch: { status: "skipped" },
    remoteBranch: { status: "skipped" },
  };

  const prUrl = resolveContextValue(context, "development.pr_url");
  const worktreePath = resolveContextValue(context, "design.worktree_path");
  const branchName = resolveContextValue(context, "design.branch_name");

  // 1. 关闭 PR
  if (prUrl) {
    result.pr = await closePr(prUrl);
  }

  // 2. 删除 worktree
  if (worktreePath) {
    result.worktree = await removeWorktree(worktreePath, workspacePath);
  }

  // 3. 删除本地分支（需要先校验分支名）
  if (branchName) {
    const validation = await validateBranchName(branchName);
    if (!validation.valid) {
      result.localBranch = { status: "failed", error: validation.error };
      result.remoteBranch = { status: "failed", error: validation.error };
    } else {
      result.localBranch = await deleteLocalBranch(branchName);
      // 4. 删除远端分支
      result.remoteBranch = await deleteRemoteBranch(branchName);
    }
  }

  log.info({ result }, "cleanup.completed");
  return result;
}

// ── 内部执行函数 ──────────────────────────────────────────────────────

interface ExecResult { stdout: string; stderr: string; exitCode: number }

function execCommand(command: string, args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const exitCode = typeof error?.code === "number" ? error.code : error ? 1 : 0;
      resolve({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        exitCode,
      });
    });
  });
}

async function closePr(prUrl: string): Promise<ResourceResult> {
  try {
    const { stderr, exitCode } = await execCommand("gh", ["pr", "close", prUrl]);
    if (exitCode === 0) {
      log.info({ prUrl }, "cleanup.pr.closed");
      return { status: "success" };
    }
    // PR 不存在或已关闭
    if (stderr.includes("not found") || stderr.includes("Could not resolve")) {
      log.info({ prUrl }, "cleanup.pr.not_found");
      return { status: "skipped", error: "PR 不存在" };
    }
    log.warn({ prUrl, stderr }, "cleanup.pr.failed");
    return { status: "failed", error: stderr };
  } catch (err) {
    log.error({ prUrl, err }, "cleanup.pr.error");
    return { status: "failed", error: String(err) };
  }
}

async function removeWorktree(worktreePath: string, workspacePath: string): Promise<ResourceResult> {
  const validation = validateWorktreePath(worktreePath, workspacePath);
  if (!validation.valid) {
    return { status: "failed", error: validation.error };
  }
  try {
    const { stderr, exitCode } = await execCommand("git", ["worktree", "remove", worktreePath]);
    if (exitCode === 0) {
      log.info({ worktreePath }, "cleanup.worktree.removed");
      return { status: "success" };
    }
    // 目录不存在
    if (stderr.includes("not a working tree") || stderr.includes("No such file")) {
      log.info({ worktreePath }, "cleanup.worktree.not_found");
      return { status: "skipped", error: "worktree 不存在" };
    }
    // 有未提交更改
    if (stderr.includes("contains modified") || stderr.includes("dirty")) {
      log.warn({ worktreePath }, "cleanup.worktree.dirty");
      return { status: "failed", error: "worktree 有未提交更改，请手动处理" };
    }
    log.warn({ worktreePath, stderr }, "cleanup.worktree.failed");
    return { status: "failed", error: stderr };
  } catch (err) {
    log.error({ worktreePath, err }, "cleanup.worktree.error");
    return { status: "failed", error: String(err) };
  }
}

async function deleteLocalBranch(branchName: string): Promise<ResourceResult> {
  try {
    const { stderr, exitCode } = await execCommand("git", ["branch", "-d", branchName]);
    if (exitCode === 0) {
      log.info({ branchName }, "cleanup.local_branch.deleted");
      return { status: "success" };
    }
    // 分支不存在
    if (stderr.includes("not found") || stderr.includes("No such branch")) {
      log.info({ branchName }, "cleanup.local_branch.not_found");
      return { status: "skipped", error: "本地分支不存在" };
    }
    // 分支未合入
    if (stderr.includes("not fully merged")) {
      log.warn({ branchName }, "cleanup.local_branch.not_merged");
      return { status: "failed", error: "分支未合入，请手动处理" };
    }
    log.warn({ branchName, stderr }, "cleanup.local_branch.failed");
    return { status: "failed", error: stderr };
  } catch (err) {
    log.error({ branchName, err }, "cleanup.local_branch.error");
    return { status: "failed", error: String(err) };
  }
}

async function deleteRemoteBranch(branchName: string): Promise<ResourceResult> {
  try {
    const { stderr, exitCode } = await execCommand("git", ["push", "origin", "--delete", branchName]);
    if (exitCode === 0) {
      log.info({ branchName }, "cleanup.remote_branch.deleted");
      return { status: "success" };
    }
    // 远端分支不存在
    if (stderr.includes("remote ref does not exist") || stderr.includes("Could not find ref") || stderr.includes("error: unable to delete")) {
      log.info({ branchName }, "cleanup.remote_branch.not_found");
      return { status: "skipped", error: "远端分支不存在" };
    }
    log.warn({ branchName, stderr }, "cleanup.remote_branch.failed");
    return { status: "failed", error: stderr };
  } catch (err) {
    log.error({ branchName, err }, "cleanup.remote_branch.error");
    return { status: "failed", error: String(err) };
  }
}
