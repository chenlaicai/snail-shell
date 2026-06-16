import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { checkIssueDocNumbering } from "../../scripts/check-issue-doc-numbering";

function writeIssueDoc(rootDir: string, relativePath: string): void {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // Extract issue ID from filename: I2026051901-alpha.md → I2026051901
  const basename = path.basename(relativePath, ".md");
  const prefix = basename.replace(/-.*$/, "");

  fs.writeFileSync(filePath, `---
id: ${prefix}
title: fixture
from_ids: []
tags: []
modules: [workspace_management]
---
# fixture\n`, "utf8");
}

function withFixture(files: string[], run: (rootDir: string) => void): void {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-doc-numbering-"));
  try {
    for (const file of files) writeIssueDoc(rootDir, file);
    run(rootDir);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

withFixture([
  "docs/issues/2026/05/19/I2026051901-alpha.md",
  "docs/issues/2026/05/19/I2026051902-beta.md",
], (rootDir) => {
  assert.deepStrictEqual(checkIssueDocNumbering(rootDir), [], "unique issue doc numbers in matching date directories should pass");
});

withFixture([
  "docs/issues/2026/05/19/I2026051901-alpha.md",
  "docs/issues/2026/05/19/I2026051901-beta.md",
], (rootDir) => {
  const issues = checkIssueDocNumbering(rootDir);
  assert.strictEqual(issues.length, 1, "duplicate issue doc numbers should be reported");
  assert(issues[0].message.includes("重复编号 I2026051901"), "duplicate issue should name the conflicting prefix");
  assert.deepStrictEqual(issues[0].files, [
    "docs/issues/2026/05/19/I2026051901-alpha.md",
    "docs/issues/2026/05/19/I2026051901-beta.md",
  ]);
});

withFixture([
  "docs/issues/2026/05/20/I2026051901-alpha.md",
], (rootDir) => {
  const issues = checkIssueDocNumbering(rootDir);
  assert.strictEqual(issues.length, 1, "date directory mismatches should be reported");
  assert(issues[0].message.includes("所在日期目录与编号 I2026051901 不一致"), "date mismatch issue should name the mismatched prefix");
  assert.deepStrictEqual(issues[0].files, ["docs/issues/2026/05/20/I2026051901-alpha.md"]);
});

const issues = checkIssueDocNumbering(process.cwd());

assert.deepStrictEqual(issues, [], `issue doc numbering issues:\n${issues.map((issue) => `${issue.message}\n${issue.files.join("\n")}`).join("\n")}`);

console.log("issue-doc-numbering tests passed");
