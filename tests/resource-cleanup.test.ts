import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateBranchName, validateWorktreePath, cleanupResources } from "@app/issue-collaboration/resource-cleanup";

// ── Mock child_process ────────────────────────────────────────────────

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, default: actual, realpathSync: vi.fn((p: string) => p) as unknown as typeof import("fs").realpathSync };
});

import { execFile } from "child_process";
import { realpathSync } from "fs";

const mockExecFile = vi.mocked(execFile);
const mockRealpathSync = vi.mocked(realpathSync) as unknown as ReturnType<typeof vi.fn>;

function mockExecSuccess(stdout = "", stderr = "") {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    cb?.(null, stdout, stderr);
    return {} as any;
  });
}

function mockExecFail(exitCode: number, stderr: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    const err = Object.assign(new Error("Command failed"), { code: exitCode });
    cb?.(err, "", stderr);
    return {} as any;
  });
}

// ── validateBranchName ────────────────────────────────────────────────

describe("validateBranchName", () => {
  it("拒绝 main 分支", () => {
    expect(validateBranchName("main")).toEqual({ valid: false, error: "拒绝删除保留分支: main" });
  });

  it("拒绝 master 分支", () => {
    expect(validateBranchName("master")).toEqual({ valid: false, error: "拒绝删除保留分支: master" });
  });

  it("拒绝 origin/ 前缀", () => {
    expect(validateBranchName("origin/feature-x")).toEqual({ valid: false, error: "拒绝删除远端引用: origin/feature-x" });
  });

  it("拒绝含 .. 的分支名", () => {
    expect(validateBranchName("feature..x")).toEqual({ valid: false, error: "分支名含非法字符: feature..x" });
  });

  it("拒绝含空格的分支名", () => {
    expect(validateBranchName("feature x")).toEqual({ valid: false, error: "分支名含非法字符: feature x" });
  });

  it("接受合法分支名", () => {
    expect(validateBranchName("feature-close-auto-cleanup")).toEqual({ valid: true });
  });

  it("接受含斜杠的分支名（非 origin/ 前缀）", () => {
    expect(validateBranchName("feature/close-auto-cleanup")).toEqual({ valid: true });
  });
});

// ── validateWorktreePath ──────────────────────────────────────────────

describe("validateWorktreePath", () => {
  const workspacePath = "/Users/dev/project";

  beforeEach(() => {
    mockRealpathSync.mockImplementation((p: string) => p);
  });

  it("拒绝删除仓库主目录", () => {
    expect(validateWorktreePath(workspacePath, workspacePath)).toEqual({
      valid: false,
      error: "拒绝删除仓库主目录",
    });
  });

  it("拒绝不在白名单内的路径", () => {
    expect(validateWorktreePath("/Users/dev/project/src", workspacePath)).toEqual({
      valid: false,
      error: "路径不在允许的 worktree 白名单内: /Users/dev/project/src",
    });
  });

  it("接受 .snail/worktrees/ 下的路径", () => {
    expect(validateWorktreePath("/Users/dev/project/.snail/worktrees/feature-x", workspacePath)).toEqual({ valid: true });
  });

  it("接受 .claude/worktrees/ 下的路径", () => {
    expect(validateWorktreePath("/Users/dev/project/.claude/worktrees/feature-x", workspacePath)).toEqual({ valid: true });
  });

  it("处理 realpathSync 失败（路径不存在）", () => {
    mockRealpathSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(validateWorktreePath("/nonexistent", workspacePath)).toEqual({
      valid: false,
      error: "路径解析失败: /nonexistent",
    });
  });

  it("处理 macOS /var → /private/var 符号链接", () => {
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === "/var/folders/project/.snail/worktrees/wt") return "/private/var/folders/project/.snail/worktrees/wt";
      if (p === "/var/folders/project") return "/private/var/folders/project";
      return p;
    });
    expect(validateWorktreePath("/var/folders/project/.snail/worktrees/wt", "/var/folders/project")).toEqual({ valid: true });
  });
});

// ── cleanupResources ──────────────────────────────────────────────────

describe("cleanupResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRealpathSync.mockImplementation((p: string) => p);
  });

  it("无关联资源时全部 skipped", async () => {
    const result = await cleanupResources({}, "/workspace");
    expect(result).toEqual({
      pr: { status: "skipped" },
      worktree: { status: "skipped" },
      localBranch: { status: "skipped" },
      remoteBranch: { status: "skipped" },
    });
  });

  it("成功关闭 PR", async () => {
    mockExecSuccess();
    const result = await cleanupResources({ pr_url: "https://github.com/owner/repo/pull/42" }, "/workspace");
    expect(result.pr.status).toBe("success");
  });

  it("PR 不存在时 skipped", async () => {
    mockExecFail(1, "Could not resolve to a pull request");
    const result = await cleanupResources({ pr_url: "https://github.com/owner/repo/pull/999" }, "/workspace");
    expect(result.pr.status).toBe("skipped");
  });

  it("成功删除 worktree", async () => {
    mockExecSuccess();
    const result = await cleanupResources({ worktree_path: "/workspace/.snail/worktrees/feature-x" }, "/workspace");
    expect(result.worktree.status).toBe("success");
  });

  it("worktree 有未提交更改时 failed", async () => {
    mockExecFail(1, "fatal: '/workspace/.snail/worktrees/feature-x' contains modified or untracked files");
    const result = await cleanupResources({ worktree_path: "/workspace/.snail/worktrees/feature-x" }, "/workspace");
    expect(result.worktree.status).toBe("failed");
    expect(result.worktree.error).toContain("未提交更改");
  });

  it("worktree 路径不在白名单时 failed", async () => {
    const result = await cleanupResources({ worktree_path: "/workspace/src" }, "/workspace");
    expect(result.worktree.status).toBe("failed");
    expect(result.worktree.error).toContain("白名单");
  });

  it("成功删除本地和远端分支", async () => {
    mockExecSuccess();
    const result = await cleanupResources({ branch_name: "feature-x" }, "/workspace");
    expect(result.localBranch.status).toBe("success");
    expect(result.remoteBranch.status).toBe("success");
  });

  it("分支未合入时 localBranch failed，远端不受阻断", async () => {
    // 第一次调用（local branch -d）失败
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error("not fully merged"), { code: 1 });
      cb?.(err, "", "error: The branch 'feature-x' is not fully merged.");
      return {} as any;
    });
    // 第二次调用（push origin --delete）成功
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb?.(null, "", "");
      return {} as any;
    });
    const result = await cleanupResources({ branch_name: "feature-x" }, "/workspace");
    expect(result.localBranch.status).toBe("failed");
    expect(result.localBranch.error).toContain("未合入");
    expect(result.remoteBranch.status).toBe("success");
  });

  it("拒绝删除保留分支时 localBranch 和 remoteBranch 均 failed", async () => {
    const result = await cleanupResources({ branch_name: "main" }, "/workspace");
    expect(result.localBranch.status).toBe("failed");
    expect(result.localBranch.error).toContain("保留分支");
    expect(result.remoteBranch.status).toBe("failed");
    expect(result.remoteBranch.error).toContain("保留分支");
    // 不应调用任何 git 命令
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("远端分支不存在时 skipped", async () => {
    // local branch 成功
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb?.(null, "", "");
      return {} as any;
    });
    // remote branch 失败 - 不存在
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error("push failed"), { code: 1 });
      cb?.(err, "", "error: remote ref does not exist");
      return {} as any;
    });
    const result = await cleanupResources({ branch_name: "feature-x" }, "/workspace");
    expect(result.localBranch.status).toBe("success");
    expect(result.remoteBranch.status).toBe("skipped");
  });

  it("完整清理流程：PR → worktree → local branch → remote branch", async () => {
    mockExecSuccess();
    const result = await cleanupResources({
      pr_url: "https://github.com/owner/repo/pull/42",
      worktree_path: "/workspace/.snail/worktrees/feature-x",
      branch_name: "feature/x",
    }, "/workspace");
    expect(result.pr.status).toBe("success");
    expect(result.worktree.status).toBe("success");
    expect(result.localBranch.status).toBe("success");
    expect(result.remoteBranch.status).toBe("success");
  });
});
