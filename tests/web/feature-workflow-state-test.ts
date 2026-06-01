import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const SAMPLE_TRANSITIONS = [
  { from_stage_key: "design", to_stage_key: "development" },
  { from_stage_key: "development", to_stage_key: "review" },
  { from_stage_key: "review", to_stage_key: "merge" },
  { from_stage_key: "development", to_stage_key: "design" },
  { from_stage_key: "review", to_stage_key: "design" },
  { from_stage_key: "merge", to_stage_key: "review" },
];

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/feature-workflow-state.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{
    canTransitionFrom: (feature: any, stage: any, transitions: any) => boolean;
    featureRepoContextFields: (stage: any) => { branch_name: string; worktree_path: string; pr_url: string };
    hasFeatureRepoContext: (stage: any) => boolean;
  }>;
  const { canTransitionFrom, featureRepoContextFields, hasFeatureRepoContext } = await dynamicImport(moduleUrl);

  // canTransitionFrom tests
  assert(canTransitionFrom({ closed_at: null }, { type: "design" }, SAMPLE_TRANSITIONS), "open feature with design stage should have forward transitions");
  assert(canTransitionFrom({ closed_at: null }, { type: "development" }, SAMPLE_TRANSITIONS), "development stage should have forward transitions (review + design bounce)");
  assert(canTransitionFrom({ closed_at: null }, { type: "merge" }, SAMPLE_TRANSITIONS), "merge stage should have forward transition (review bounce)");
  assert(!canTransitionFrom({ closed_at: "2026-01-01" }, { type: "design" }, SAMPLE_TRANSITIONS), "closed feature should not allow transitions");
  assert(!canTransitionFrom(null, { type: "design" }, SAMPLE_TRANSITIONS), "missing feature should not allow transitions");
  assert(!canTransitionFrom({ closed_at: null }, null, SAMPLE_TRANSITIONS), "missing stage should not allow transitions");
  assert(!canTransitionFrom({ closed_at: null }, { type: "design" }, null), "missing transitions should not allow transitions");
  assert(!canTransitionFrom({ closed_at: null }, { type: "unknown" }, SAMPLE_TRANSITIONS), "unknown stage type should not have transitions");

  // featureRepoContextFields tests (unchanged)
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
