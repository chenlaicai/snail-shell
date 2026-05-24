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
    featureRepoContextFields: (stage: any) => { branch_name: string; worktree_path: string; pr_url: string };
    hasFeatureRepoContext: (stage: any) => boolean;
  }>;
  const { canRestartFeatureDevelopment, featureRepoContextFields, hasFeatureRepoContext } = await dynamicImport(moduleUrl);

  assert(canRestartFeatureDevelopment({ current_stage: { id: "development-1" } }, { id: "development-1", type: "development", status: "in_progress" }), "open feature with in-progress development stage should be restartable");
  assert(canRestartFeatureDevelopment({ current_stage: { id: "review-2" } }, { id: "review-2", type: "review", status: "completed" }), "open feature should allow restarting from latest completed review stage");
  assert(!canRestartFeatureDevelopment({ current_stage: { id: "review-2" } }, { id: "review-1", type: "review", status: "completed" }), "open feature should not allow restarting from stale completed review stage");
  assert(!canRestartFeatureDevelopment({ current_stage: { id: "review-1" } }, { id: "review-1", type: "review", status: "in_progress" }), "in-progress review should not bypass normal review completion");
  assert(!canRestartFeatureDevelopment({ current_stage: { id: "development-1" } }, { id: "development-1", type: "development", status: "completed" }), "open feature should only restart from the completed review stage");
  assert(!canRestartFeatureDevelopment({ closed_at: "2026-01-01T00:00:00Z", current_stage: { id: "review-2" } }, { id: "review-2", type: "review", status: "completed" }), "closed feature should not be restartable even from completed review stage");
  assert(!canRestartFeatureDevelopment(null, { type: "development", status: "in_progress" }), "missing feature should not be restartable");
  assert(!hasFeatureRepoContext(null), "missing stage should not report repo context");
  assert(!hasFeatureRepoContext({ output_artifacts: {} }), "empty output_artifacts should not report repo context");
  assert(hasFeatureRepoContext({ output_artifacts: { branch_name: "feature/a" } }), "recorded branch in stage should count as repo context");
  const fields = featureRepoContextFields({ output_artifacts: { branch_name: "feature/a", worktree_path: "/tmp/worktree", pr_url: "https://example.test/pr/1" } });
  assert(fields.branch_name === "feature/a" && fields.worktree_path === "/tmp/worktree" && fields.pr_url === "https://example.test/pr/1", "repo context fields should preserve recorded values");

  const readonlyModulePath = path.resolve(__dirname, "../../src/web/feature-readonly-state.js");
  const readonlyModule = await new Function("moduleUrl", "return import(moduleUrl);")(readonlyModulePath) as { isFeatureArchived: (feature: any) => boolean };
  const { isFeatureArchived } = readonlyModule as { isFeatureArchived: (feature: any) => boolean };
  assert(!isFeatureArchived(null), "null feature should not be classified as archived");
  assert(!isFeatureArchived(undefined), "undefined feature should not be classified as archived");
  assert(!isFeatureArchived({ closed_at: null }), "feature with null closed_at should not be classified as archived");
  assert(!isFeatureArchived({}), "feature without closed_at should not be classified as archived");
  assert(isFeatureArchived({ closed_at: "2026-01-01T00:00:00Z" }), "feature with closed_at should be classified as archived");

  console.log("feature-workflow-state tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
