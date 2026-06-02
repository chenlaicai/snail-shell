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
    canRestartIssueDevelopment: (issue: any, stage: any) => boolean;
    issueRepoContextFields: (stage: any) => { branch_name: string; worktree_path: string; pr_url: string };
    hasIssueRepoContext: (stage: any) => boolean;
  }>;
  const { canRestartIssueDevelopment, issueRepoContextFields, hasIssueRepoContext } = await dynamicImport(moduleUrl);

  assert(canRestartIssueDevelopment({ current_stage: { id: "design-1" } }, { id: "design-1", type: "design", status: "in_progress" }), "open issue with in-progress design stage should be restartable");
  assert(canRestartIssueDevelopment({ current_stage: { id: "review-2" } }, { id: "review-2", type: "review", status: "completed" }), "open issue should allow restarting from latest completed review stage");
  assert(!canRestartIssueDevelopment({ current_stage: { id: "review-2" } }, { id: "review-1", type: "review", status: "completed" }), "open issue should not allow restarting from stale completed review stage");
  assert(!canRestartIssueDevelopment({ current_stage: { id: "review-1" } }, { id: "review-1", type: "review", status: "in_progress" }), "in-progress review should not bypass normal review completion");
  assert(canRestartIssueDevelopment({ current_stage: { id: "development-1" } }, { id: "development-1", type: "development", status: "completed" }), "open issue should allow restarting from completed development stage (bounce to design)");
  assert(canRestartIssueDevelopment({ current_stage: { id: "merge-1" } }, { id: "merge-1", type: "merge", status: "completed" }), "open issue should allow restarting from completed merge stage (bounce to review)");
  assert(!canRestartIssueDevelopment({ closed_at: "2026-01-01T00:00:00Z", current_stage: { id: "review-2" } }, { id: "review-2", type: "review", status: "completed" }), "closed issue should not be restartable even from completed review stage");
  assert(!canRestartIssueDevelopment(null, { type: "design", status: "in_progress" }), "missing issue should not be restartable");
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
