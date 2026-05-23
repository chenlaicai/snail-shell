import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { ProjectManager } from "../../src/project-workflow/manager";
import { cleanupFeatureRepoContext } from "../../src/project-workflow/repo-cleanup";
import { ConversationStore } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/roles";
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
    testScriptUsesPrimaryRepoDatabaseFromWorktree(fixtureRoot);
    testScriptExplainsMissingFeature(fixtureRoot);

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
    { key: "review", title: "PR 检视", sequence: 2, roles: [{ name: "检视者", snail_template_id: "opencode-default", is_primary: true }] },
  ]);
  const sourceWrapperPath = path.join(process.cwd(), ".meta", "skills", "record-feature-repo-context", "scripts", "record-feature-repo-context.js");
  execFileSync(sourceWrapperPath, [
    "--db-path", dbPath,
    "--feature-id", created.feature.id,
    "--set", `branch_name=${scriptBranch}`,
    "--set", `worktree_path=${worktreePath}`,
    "--set", "pr_url=https://github.com/chenlaicai/snail-shell/pull/100",
  ], { cwd: process.cwd(), stdio: "pipe" });

  const recordedStage = store.getStage(created.stage.id)!;
  assert.equal(recordedStage.output_artifacts["branch_name"], scriptBranch, "script should persist branch name on the stage");
  assert.equal(recordedStage.output_artifacts["worktree_path"], worktreePath, "script should persist worktree path on the stage");
  assert.equal(recordedStage.output_artifacts["pr_url"], "https://github.com/chenlaicai/snail-shell/pull/100", "script should persist PR URL on the stage");

  const archived = manager.archiveFeature(created.feature.id);
  assert.equal(archived.cleanup.steps.find((step) => step.target === "worktree")?.status, "removed", "archive should consume script-recorded worktree path");
  assert.equal(archived.cleanup.steps.find((step) => step.target === "branch")?.status, "removed", "archive should consume script-recorded branch name");
  assert(!fs.existsSync(worktreePath), "archive should remove script-recorded worktree");
  const distWrapperPath = path.join(process.cwd(), "dist", ".meta", "scripts", "record-feature-repo-context.js");
  const distWrapperResult = spawnSync(distWrapperPath, ["--db-path", dbPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(distWrapperResult.stderr, undefined, "dist wrapper should produce a captured stderr stream");
  assert.equal(distWrapperResult.status, 1, "dist wrapper should execute bin validation instead of failing before node starts");
  assert(distWrapperResult.stderr.includes("--set"), "dist wrapper should reach record-feature-repo-context argument validation");
  store.close();
}

function testScriptUsesPrimaryRepoDatabaseFromWorktree(fixtureRoot: string): void {
  const repoRoot = path.join(fixtureRoot, "default-db-snail-shell");
  const worktreesRoot = path.join(fixtureRoot, "snail-shell-worktrees");
  fs.mkdirSync(path.join(repoRoot, "data"), { recursive: true });
  fs.mkdirSync(worktreesRoot, { recursive: true });
  fs.cpSync(path.join(process.cwd(), "dist", "src"), path.join(repoRoot, "dist", "src"), { recursive: true });
  fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(repoRoot, "node_modules"), "dir");
  fs.writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ type: "commonjs" }));
  const wrapperPath = path.join(repoRoot, ".meta", "skills", "record-feature-repo-context", "scripts", "record-feature-repo-context.js");
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), ".meta", "skills", "record-feature-repo-context", "scripts", "record-feature-repo-context.js"),
    wrapperPath,
  );
  fs.chmodSync(wrapperPath, 0o755);
  git(repoRoot, ["init"]);
  git(repoRoot, ["config", "user.email", "test@example.com"]);
  git(repoRoot, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "fixture\n");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "init"]);
  git(repoRoot, ["branch", "-M", "main"]);
  git(repoRoot, ["branch", "default-db-worktree"]);

  const dbPath = path.join(repoRoot, "data", "snail-shell.db");
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
  const created = manager.createProject("Default DB Test", "test", "system_self", [
    { key: "development", title: "研发迭代", sequence: 1, roles: [{ name: "研发者", snail_template_id: "opencode-default", is_primary: true }] },
    { key: "review", title: "PR 检视", sequence: 2, roles: [{ name: "检视者", snail_template_id: "opencode-default", is_primary: true }] },
  ]);

  const worktreePath = path.join(worktreesRoot, "default-db");
  git(repoRoot, ["worktree", "add", worktreePath, "default-db-worktree"]);
  execFileSync(wrapperPath, [
    "--feature-id", created.feature.id,
    "--set", "branch_name=feature/default-db",
  ], { cwd: worktreePath, stdio: "pipe", env: withoutDbPathEnv() });

  const recordedStage = store.getStage(created.stage.id)!;
  assert.equal(recordedStage.output_artifacts["branch_name"], "feature/default-db", "worktree invocation should update the primary repo database by default");
  assert(!fs.existsSync(path.join(worktreePath, "data", "snail-shell.db")), "worktree invocation must not create an isolated empty database by default");
  store.close();
}

function testScriptExplainsMissingFeature(fixtureRoot: string): void {
  const dbPath = path.join(fixtureRoot, "missing-feature.db");
  const store = new ConversationStore(dbPath);
  store.close();
  const sourceWrapperPath = path.join(process.cwd(), ".meta", "skills", "record-feature-repo-context", "scripts", "record-feature-repo-context.js");
  const result = spawnSync(sourceWrapperPath, [
    "--db-path", dbPath,
    "--feature-id", "F2099010199",
    "--set", "branch_name=feature/missing",
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(result.status, 1, "missing feature should fail");
  assert(result.stderr.includes("F2099010199"), "missing feature error should include the feature id");
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

function feature(input: { branch_name: string; worktree_path: string }): Record<string, string> {
  return {
    branch_name: input.branch_name,
    worktree_path: input.worktree_path,
    pr_url: "https://github.com/chenlaicai/snail-shell/pull/1",
  };
}

function git(cwd: string, args: string[]): void {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  execFileSync("git", args, { cwd, stdio: "pipe", env });
}

function withoutDbPathEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.DB_PATH;
  return env;
}
