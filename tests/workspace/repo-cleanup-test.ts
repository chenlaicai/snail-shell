import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { WorkspaceManager } from "../../src/workspace-workflow/manager";
import { cleanupFeatureRepoContext } from "../../src/workspace-workflow/repo-cleanup";
import { ConversationStore } from "../../src/persistence/store";
import { RoleRegistry } from "../../src/roles";
import type { AgentRuntime } from "../../src/agent/interface";
import type { SnailDen } from "../../src/snail-den";
import { upsertSopFromYaml } from "../../src/persistence/sop-model";

function seedTestSop(store: ConversationStore): void {
  upsertSopFromYaml(store.getDb(), { id: "sop-test", source: "platform", sourceRef: null, key: "test-sop", name: "Test SOP", description: null }, [
    { key: "design", title: "需求对齐与设计", sequence: 1, roles: [{ key: "designer", name: "设计者", description: "designer", is_primary: true }] },
    { key: "development", title: "研发实现", sequence: 2, roles: [{ key: "developer", name: "研发者", description: "dev", is_primary: true }] },
    { key: "review", title: "PR 检视", sequence: 3, roles: [{ key: "reviewer", name: "检视者", description: "rev", is_primary: true }] },
    { key: "merge", title: "合入", sequence: 4, roles: [{ key: "merger", name: "合入者", description: "merger", is_primary: true }] },
  ]);
}

run();

function run(): void {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "snail-repo-cleanup-"));
  try {
    const cleanupBranch = `feature/cleanup-test-${path.basename(fixtureRoot)}`;
    const repoRoot = path.join(fixtureRoot, "snail-shell");
    const worktreesRoot = path.join(repoRoot, ".snail", "worktrees");
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
    testScriptFirstTimeRecordingAutoDiscoversStage(fixtureRoot);

    console.log("repo-cleanup tests passed");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function testScriptRecordsContextConsumedByArchive(fixtureRoot: string): void {
  const scriptBranch = `feature/script-record-${path.basename(fixtureRoot)}`;
  const repoRoot = path.join(fixtureRoot, "script-snail-shell");
  const worktreesRoot = path.join(repoRoot, ".snail", "worktrees");
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
  seedTestSop(store);
  const manager = new WorkspaceManager(store, agentResolver(), { roleRegistry: new RoleRegistry(store), systemAI: systemAI(), snailDen: {
      getTemplate: () => undefined,
      listTemplates: () => [],
      getSnailRuntime: (templateId: string) => ({
        runtime: { name: templateId, runtime: "opencode-cli" as AgentRuntime, invokeMessage: async () => ({}) },
        model: "default",
        contextWindow: null,
        template: { id: templateId, name: templateId, runtime: "opencode-cli" as AgentRuntime, model: "default" },
      }),
    } as unknown as SnailDen }, { repoRoot });
  const created = manager.createWorkspace("Script Record Test", { summary: "test", workspaceRoot: process.cwd(), sopId: "sop-test", roleBindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } });
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
  const worktreesRoot = path.join(repoRoot, ".snail", "worktrees");
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
  // 同时复制 db-bridge，保障 wrapper 子进程能找到 bridge
  const bridgeTargetPath = path.join(repoRoot, ".meta", "scripts", "db-bridge.js");
  fs.mkdirSync(path.dirname(bridgeTargetPath), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), ".meta", "scripts", "db-bridge.js"), bridgeTargetPath);
  fs.chmodSync(bridgeTargetPath, 0o755);
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
  seedTestSop(store);
  const manager = new WorkspaceManager(store, agentResolver(), { roleRegistry: new RoleRegistry(store), systemAI: systemAI(), snailDen: {
      getTemplate: () => undefined,
      listTemplates: () => [],
      getSnailRuntime: (templateId: string) => ({
        runtime: { name: templateId, runtime: "opencode-cli" as AgentRuntime, invokeMessage: async () => ({}) },
        model: "default",
        contextWindow: null,
        template: { id: templateId, name: templateId, runtime: "opencode-cli" as AgentRuntime, model: "default" },
      }),
    } as unknown as SnailDen }, { repoRoot });
  const created = manager.createWorkspace("Default DB Test", { summary: "test", workspaceRoot: process.cwd(), sopId: "sop-test", roleBindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } });

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

function testScriptFirstTimeRecordingAutoDiscoversStage(fixtureRoot: string): void {
  const scriptBranch = `feature/first-time-${path.basename(fixtureRoot)}`;
  const repoRoot = path.join(fixtureRoot, "first-time-snail-shell");
  const worktreesRoot = path.join(repoRoot, ".snail", "worktrees");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(worktreesRoot, { recursive: true });

  // Set up git repo with a branch and worktree
  git(repoRoot, ["init"]);
  git(repoRoot, ["config", "user.email", "test@example.com"]);
  git(repoRoot, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "fixture\n");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "init"]);
  git(repoRoot, ["branch", "-M", "main"]);
  git(repoRoot, ["checkout", "-b", scriptBranch]);
  git(repoRoot, ["checkout", "main"]);
  const worktreePath = path.join(worktreesRoot, "first-time-record");
  git(repoRoot, ["worktree", "add", worktreePath, scriptBranch]);

  // Create feature + development stage with EMPTY output_artifacts (first-time scenario)
  const dbPath = path.join(fixtureRoot, "first-time.db");
  const store = new ConversationStore(dbPath);
  seedTestSop(store);
  const manager = new WorkspaceManager(store, agentResolver(), { roleRegistry: new RoleRegistry(store), systemAI: systemAI(), snailDen: {
      getTemplate: () => undefined,
      listTemplates: () => [],
      getSnailRuntime: (templateId: string) => ({
        runtime: { name: templateId, runtime: "opencode-cli" as AgentRuntime, invokeMessage: async () => ({}) },
        model: "default",
        contextWindow: null,
        template: { id: templateId, name: templateId, runtime: "opencode-cli" as AgentRuntime, model: "default" },
      }),
    } as unknown as SnailDen }, { repoRoot });
  const created = manager.createWorkspace("First Time Test", { summary: "test", workspaceRoot: process.cwd(), sopId: "sop-test", roleBindings: { designer: "opencode-default", developer: "opencode-default", reviewer: "opencode-default", merger: "opencode-default" } });

  // Verify output_artifacts is empty before the script runs
  const stageBefore = store.getStage(created.stage.id)!;
  assert.strictEqual(stageBefore.output_artifacts?.worktree_path ?? null, null,
    "output_artifacts.worktree_path should be empty before first recording");

  // Copy the script to the repo so it can be executed
  const wrapperPath = path.join(repoRoot, ".meta", "skills", "record-feature-repo-context", "scripts", "record-feature-repo-context.js");
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), ".meta", "skills", "record-feature-repo-context", "scripts", "record-feature-repo-context.js"),
    wrapperPath,
  );
  fs.chmodSync(wrapperPath, 0o755);
  // 同时复制 db-bridge，保障 wrapper 子进程能找到 bridge
  const bridgeTargetPath = path.join(repoRoot, ".meta", "scripts", "db-bridge.js");
  fs.mkdirSync(path.dirname(bridgeTargetPath), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), ".meta", "scripts", "db-bridge.js"), bridgeTargetPath);
  fs.chmodSync(bridgeTargetPath, 0o755);
  fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(repoRoot, "node_modules"), "dir");

  // Test 1: FIRST-TIME recording with --stage-id (reliable path, output_artifacts empty)
  execFileSync(wrapperPath, [
    "--db-path", dbPath,
    "--stage-id", created.stage.id,
    "--set", `branch_name=${scriptBranch}`,
    "--set", `worktree_path=${worktreePath}`,
    "--set", "pr_url=https://github.com/chenlaicai/snail-shell/pull/1",
  ], { cwd: worktreePath, stdio: "pipe", env: withoutDbPathEnv() });

  const recordedStage = store.getStage(created.stage.id)!;
  assert.strictEqual(recordedStage.output_artifacts["branch_name"], scriptBranch,
    "first-time recording with --stage-id should persist branch_name");
  assert.strictEqual(recordedStage.output_artifacts["worktree_path"], worktreePath,
    "first-time recording with --stage-id should persist worktree_path");
  assert.strictEqual(recordedStage.output_artifacts["pr_url"], "https://github.com/chenlaicai/snail-shell/pull/1",
    "first-time recording with --stage-id should persist pr_url");

  // Test 2: RE-RECORDING without --stage-id (auto-discovery via worktree_path match)
  execFileSync(wrapperPath, [
    "--db-path", dbPath,
    "--set", "branch_name=feature/re-recorded",
  ], { cwd: worktreePath, stdio: "pipe", env: withoutDbPathEnv() });

  const reRecorded = store.getStage(created.stage.id)!;
  assert.strictEqual(reRecorded.output_artifacts["branch_name"], "feature/re-recorded",
    "re-recording without --stage-id should update via auto-discovery");
  assert.strictEqual(reRecorded.output_artifacts["worktree_path"], worktreePath,
    "re-recording should preserve existing worktree_path");

  // Test 3: negative — sibling directory prefix must NOT match
  const siblingPath = worktreePath + "-sibling";
  fs.mkdirSync(siblingPath, { recursive: true });
  const siblingResult = spawnSync(wrapperPath, [
    "--db-path", dbPath,
    "--set", "branch_name=feature/sibling",
  ], { cwd: siblingPath, encoding: "utf8", env: withoutDbPathEnv() });

  assert.notStrictEqual(siblingResult.status, 0,
    "sibling directory should NOT match via startsWith");
  assert(siblingResult.stderr.includes("Could not determine target stage"),
    "sibling directory should fail with stage discovery error");

  const unchanged = store.getStage(created.stage.id)!;
  assert.strictEqual(unchanged.output_artifacts["branch_name"], "feature/re-recorded",
    "sibling execution should not overwrite the correct stage");

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
