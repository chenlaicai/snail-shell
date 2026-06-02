import fs from "fs";
import path from "path";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const modulePath = path.resolve(__dirname, "../../src/web/issue-workflow-state.js");
  const moduleSource = fs.readFileSync(modulePath, "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  const dynamicImport = new Function("moduleUrl", "return import(moduleUrl);") as (moduleUrl: string) => Promise<{
    canTransitionFrom: (issue: any, stage: any, transitions: any[]) => boolean;
    issueRepoContextFields: (stage: any) => { branch_name: string; worktree_path: string; pr_url: string };
    hasIssueRepoContext: (stage: any) => boolean;
  }>;
  const { canTransitionFrom, issueRepoContextFields, hasIssueRepoContext } = await dynamicImport(moduleUrl);

  const transitions = [
    { from_stage_key: "design", to_stage_key: "development" },
    { from_stage_key: "development", to_stage_key: "review" },
    { from_stage_key: "review", to_stage_key: "merge" },
    { from_stage_key: "development", to_stage_key: "design" },
    { from_stage_key: "review", to_stage_key: "design" },
    { from_stage_key: "merge", to_stage_key: "review" },
  ];

  assert(canTransitionFrom({}, { type: "design" }, transitions), "open issue with design stage should have transitions");
  assert(canTransitionFrom({}, { type: "development" }, transitions), "open issue with development stage should have transitions");
  assert(canTransitionFrom({}, { type: "review" }, transitions), "open issue with review stage should have transitions");
  assert(canTransitionFrom({}, { type: "merge" }, transitions), "open issue with merge stage should have transitions");
  assert(!canTransitionFrom({}, { type: "unknown" }, transitions), "unknown stage type should have no transitions");
  assert(!canTransitionFrom({ closed_at: "2026-01-01T00:00:00Z" }, { type: "design" }, transitions), "closed issue should not be transitionable");
  assert(!canTransitionFrom(null, { type: "design" }, transitions), "null issue should not be transitionable");
  assert(!canTransitionFrom({}, null, transitions), "null stage should not be transitionable");
  assert(!canTransitionFrom({}, { type: "design" }, null as any), "null transitions should not be transitionable");
  assert(!hasIssueRepoContext(null), "missing stage should not report repo context");
  assert(!hasIssueRepoContext({ output_artifacts: {} }), "empty output_artifacts should not report repo context");
  assert(hasIssueRepoContext({ output_artifacts: { branch_name: "feature/a" } }), "recorded branch in stage should count as repo context");
  const fields = issueRepoContextFields({ output_artifacts: { branch_name: "feature/a", worktree_path: "/tmp/worktree", pr_url: "https://example.test/pr/1" } });
  assert(fields.branch_name === "feature/a" && fields.worktree_path === "/tmp/worktree" && fields.pr_url === "https://example.test/pr/1", "repo context fields should preserve recorded values");

  const readonlyModulePath = path.resolve(__dirname, "../../src/web/issue-readonly-state.js");
  const readonlyModule = await new Function("moduleUrl", "return import(moduleUrl);")(readonlyModulePath) as { isIssueArchived: (issue: any) => boolean };
  const { isIssueArchived } = readonlyModule as { isIssueArchived: (issue: any) => boolean };
  assert(!isIssueArchived(null), "null issue should not be classified as archived");
  assert(!isIssueArchived(undefined), "undefined issue should not be classified as archived");
  assert(!isIssueArchived({ closed_at: null }), "issue with null closed_at should not be classified as archived");
  assert(!isIssueArchived({}), "issue without closed_at should not be classified as archived");
  assert(isIssueArchived({ closed_at: "2026-01-01T00:00:00Z" }), "issue with closed_at should be classified as archived");

  console.log("issue-workflow-state tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
