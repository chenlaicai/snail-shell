import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { ProjectManager } from "../../src/project-workflow/manager";
import { cleanupFeatureRepoContext } from "../../src/project-workflow/repo-cleanup";
import { ConversationStore } from "../../src/persistence/store";
import type { Feature } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/snails";
import type { AgentRuntime } from "../../src/agent/interface";
import type { SnailDen } from "../../src/snail-den";

run();

function run(): void {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "snail-repo-cleanup-"));
  try {
    const cleanupBranch = `feature/cleanup-test-${path.basename(fixtureRoot)}`;
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

    git(repoRoot, ["checkout", "-b", cleanupBranch]);
    fs.writeFileSync(path.join(repoRoot, "feature.txt"), "feature\n");
    git(repoRoot, ["add", "feature.txt"]);
    git(repoRoot, ["commit", "-m", "feature"]);
    git(repoRoot, ["checkout", "main"]);
    git(repoRoot, ["merge", "--no-ff", cleanupBranch, "-m", "merge feature"]);
    const worktreePath = path.join(worktreesRoot, "cleanup-test");
    git(repoRoot, ["worktree", "add", worktreePath, cleanupBranch]);

    const cleaned = cleanupFeatureRepoContext(feature({ branch_name: cleanupBranch, worktree_path: worktreePath }), { repoRoot });
    assert.equal(cleaned.steps.find((step) => step.target === "worktree")?.status, "removed", "recorded worktree inside allowed root should be removed");
    assert.equal(cleaned.steps.find((step) => step.target === "branch")?.status, "removed", "merged recorded branch should be deleted with non-forced delete");
    assert(!fs.existsSync(worktreePath), "worktree directory should be gone after cleanup");

    const rejected = cleanupFeatureRepoContext(feature({ branch_name: "main", worktree_path: repoRoot }), { repoRoot });
    assert.equal(rejected.steps.find((step) => step.target === "worktree")?.status, "failed", "repo root must never be removed as a worktree");
    assert.equal(rejected.steps.find((step) => step.target === "branch")?.status, "failed", "protected branch must never be deleted");

    testScriptRecordsContextConsumedByArchive(fixtureRoot);

    console.log("repo-cleanup tests passed");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function testScriptRecordsContextConsumedByArchive(fixtureRoot: string): void {
  const scriptBranch = `feature/script-record-${path.basename(fixtureRoot)}`;
  const repoRoot = path.join(fixtureRoot, "script-snail-shell");
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
  git(repoRoot, ["checkout", "-b", scriptBranch]);
  fs.writeFileSync(path.join(repoRoot, "script.txt"), "feature\n");
  git(repoRoot, ["add", "script.txt"]);
  git(repoRoot, ["commit", "-m", "feature"]);
  git(repoRoot, ["checkout", "main"]);
  git(repoRoot, ["merge", "--no-ff", scriptBranch, "-m", "merge feature"]);
  const worktreePath = path.join(worktreesRoot, "script-record");
  git(repoRoot, ["worktree", "add", worktreePath, scriptBranch]);

  const dbPath = path.join(fixtureRoot, "script-record.db");
  const store = new ConversationStore(dbPath);
  const manager = new ProjectManager(store, agentResolver(), { roleRegistry: new RoleRegistry(store), systemAI: systemAI(), snailDen: {
      getTemplate: () => undefined,
      listTemplates: () => [],
      getSnailRuntime: (templateId: string) => ({
        runtime: { name: templateId, runtime: "opencode-cli" as AgentRuntime, invokeMessage: async () => ({}) },
        model: "default",
        contextWindow: null,
        template: { id: templateId, name: templateId, runtime: "opencode-cli" as AgentRuntime, model: "default" },
      }),
    } as unknown as SnailDen }, { repoRoot });
  const created = manager.createProject("Script Record Test", "test", "system_self", [
    { key: "development", title: "研发迭代", sequence: 1, roles: [{ name: "研发者", snail_template_id: "opencode-default", is_primary: true }] },
  ]);
  const sourceWrapperPath = path.join(process.cwd(), ".meta", "skills", "record-feature-repo-context", "record-feature-repo-context");
  execFileSync(sourceWrapperPath, [
    "--db-path", dbPath,
    "--feature-id", created.feature.id,
    "--branch-name", scriptBranch,
    "--worktree-path", worktreePath,
    "--pr-url", "https://github.com/chenlaicai/snail-shell/pull/100",
  ], { cwd: process.cwd(), stdio: "pipe" });

  const recordedFeature = store.getFeature(created.feature.id)!;
  assert.equal(recordedFeature.branch_name, scriptBranch, "script should persist branch name on the feature");
  assert.equal(recordedFeature.worktree_path, worktreePath, "script should persist worktree path on the feature");
  assert.equal(recordedFeature.pr_url, "https://github.com/chenlaicai/snail-shell/pull/100", "script should persist PR URL on the feature");

  const archived = manager.archiveFeature(created.feature.id);
  assert.equal(archived.cleanup.steps.find((step) => step.target === "worktree")?.status, "removed", "archive should consume script-recorded worktree path");
  assert.equal(archived.cleanup.steps.find((step) => step.target === "branch")?.status, "removed", "archive should consume script-recorded branch name");
  assert(!fs.existsSync(worktreePath), "archive should remove script-recorded worktree");
  const distWrapperPath = path.join(process.cwd(), "dist", ".meta", "scripts", "record-feature-repo-context");
  const distWrapperResult = spawnSync(distWrapperPath, ["--db-path", dbPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(distWrapperResult.stderr, undefined, "dist wrapper should produce a captured stderr stream");
  assert.equal(distWrapperResult.status, 1, "dist wrapper should execute bin validation instead of failing before node starts");
  assert(distWrapperResult.stderr.includes("--feature-id is required"), "dist wrapper should reach record-feature-repo-context argument validation");
  store.close();
}

function agentResolver() {
  return {
    resolve(runtime: AgentRuntime) {
      return {
        name: runtime,
        runtime,
        invokeMessage: async () => ({}),
      };
    },
    list: () => [],
  };
}

function systemAI() {
  return {
    generateConversationSummary: async () => "summary",
    generateMessageContextSummary: async () => "summary",
    extractMentions: async () => ({ mentions: [] }),
  };
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
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  execFileSync("git", args, { cwd, stdio: "pipe", env });
}
