import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/feature-workflow-state.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{
    canRestartFeatureDevelopment: (feature: any, stage: any) => boolean;
    featureRepoContextFields: (feature: any) => { branch_name: string; worktree_path: string; pr_url: string };
    hasFeatureRepoContext: (feature: any) => boolean;
  }>;
  const { canRestartFeatureDevelopment, featureRepoContextFields, hasFeatureRepoContext } = await dynamicImport(moduleUrl);

  assert(canRestartFeatureDevelopment({ status: "active", current_stage: { id: "development-1" } }, { id: "development-1", type: "development", status: "in_progress" }), "active development stage should be restartable");
  assert(canRestartFeatureDevelopment({ status: "waiting_merge", current_stage: { id: "review-2" } }, { id: "review-2", type: "review", status: "completed" }), "waiting merge feature should allow restarting from latest completed review stage");
  assert(!canRestartFeatureDevelopment({ status: "waiting_merge", current_stage: { id: "review-2" } }, { id: "review-1", type: "review", status: "completed" }), "waiting merge feature should not allow restarting from stale completed review stage");
  assert(!canRestartFeatureDevelopment({ status: "in_review", current_stage: { id: "review-1" } }, { id: "review-1", type: "review", status: "in_progress" }), "in-progress review should not bypass normal review completion");
  assert(!canRestartFeatureDevelopment({ status: "waiting_merge", current_stage: { id: "development-1" } }, { id: "development-1", type: "development", status: "completed" }), "waiting merge feature should only restart from the completed review stage");
  assert(!canRestartFeatureDevelopment(null, { type: "development", status: "in_progress" }), "missing feature should not be restartable");
  assert(!hasFeatureRepoContext(null), "missing feature should not report repo context");
  assert(!hasFeatureRepoContext({ branch_name: null, worktree_path: null, pr_url: null }), "empty repo context should not be reported as recorded");
  assert(hasFeatureRepoContext({ branch_name: "feature/a", worktree_path: null, pr_url: null }), "recorded branch should count as repo context");
  const fields = featureRepoContextFields({ branch_name: "feature/a", worktree_path: "/tmp/worktree", pr_url: "https://example.test/pr/1" });
  assert(fields.branch_name === "feature/a" && fields.worktree_path === "/tmp/worktree" && fields.pr_url === "https://example.test/pr/1", "repo context fields should preserve recorded values");

  console.log("feature-workflow-state tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
