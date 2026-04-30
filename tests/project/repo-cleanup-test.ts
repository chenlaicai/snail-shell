import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { cleanupFeatureRepoContext } from "../../src/project/repo-cleanup";
import type { Feature } from "../../src/persistence/store";

run();

function run(): void {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "snail-repo-cleanup-"));
  try {
    const repoRoot = path.join(fixtureRoot, "snail-shell");
    const worktreesRoot = path.join(fixtureRoot, "snail-shell-worktrees");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(worktreesRoot, { recursive: true });
    git(repoRoot, ["init"]);
    git(repoRoot, ["config", "user.email", "test@example.com"]);
    git(repoRoot, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "fixture\n");
    git(repoRoot, ["add", "README.md"]);
    git(repoRoot, ["commit", "-m", "init"]);
    git(repoRoot, ["branch", "-M", "main"]);

    git(repoRoot, ["checkout", "-b", "feature/cleanup-test"]);
    fs.writeFileSync(path.join(repoRoot, "feature.txt"), "feature\n");
    git(repoRoot, ["add", "feature.txt"]);
    git(repoRoot, ["commit", "-m", "feature"]);
    git(repoRoot, ["checkout", "main"]);
    git(repoRoot, ["merge", "--no-ff", "feature/cleanup-test", "-m", "merge feature"]);
    const worktreePath = path.join(worktreesRoot, "cleanup-test");
    git(repoRoot, ["worktree", "add", worktreePath, "feature/cleanup-test"]);

    const cleaned = cleanupFeatureRepoContext(feature({ branch_name: "feature/cleanup-test", worktree_path: worktreePath }), { repoRoot });
    assert.equal(cleaned.steps.find((step) => step.target === "worktree")?.status, "removed", "recorded worktree inside allowed root should be removed");
    assert.equal(cleaned.steps.find((step) => step.target === "branch")?.status, "removed", "merged recorded branch should be deleted with non-forced delete");
    assert(!fs.existsSync(worktreePath), "worktree directory should be gone after cleanup");

    const rejected = cleanupFeatureRepoContext(feature({ branch_name: "main", worktree_path: repoRoot }), { repoRoot });
    assert.equal(rejected.steps.find((step) => step.target === "worktree")?.status, "failed", "repo root must never be removed as a worktree");
    assert.equal(rejected.steps.find((step) => step.target === "branch")?.status, "failed", "protected branch must never be deleted");

    console.log("repo-cleanup tests passed");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function feature(input: Pick<Feature, "branch_name" | "worktree_path">): Feature {
  return {
    id: "feature-id",
    project_id: "project-id",
    title: "Feature",
    summary: null,
    status: "waiting_merge",
    branch_name: input.branch_name,
    worktree_path: input.worktree_path,
    pr_url: "https://github.com/chenlaicai/snail-shell/pull/1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    closed_at: null,
  };
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}
