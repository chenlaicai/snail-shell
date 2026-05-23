import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { checkFeatureDocNumbering } from "../../scripts/check-feature-doc-numbering";

function writeFeatureDoc(rootDir: string, relativePath: string): void {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "# fixture\n", "utf8");
}

function withFixture(files: string[], run: (rootDir: string) => void): void {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "feature-doc-numbering-"));
  try {
    for (const file of files) writeFeatureDoc(rootDir, file);
    run(rootDir);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

withFixture([
  "docs/features/20260519/F2026051901-alpha.md",
  "docs/features/20260519/F2026051902-beta.md",
], (rootDir) => {
  assert.deepStrictEqual(checkFeatureDocNumbering(rootDir), [], "unique feature doc numbers in matching date directories should pass");
});

withFixture([
  "docs/features/20260519/F2026051901-alpha.md",
  "docs/features/20260519/F2026051901-beta.md",
], (rootDir) => {
  const issues = checkFeatureDocNumbering(rootDir);
  assert.strictEqual(issues.length, 1, "duplicate feature doc numbers should be reported");
  assert(issues[0].message.includes("重复编号 F2026051901"), "duplicate issue should name the conflicting prefix");
  assert.deepStrictEqual(issues[0].files, [
    "docs/features/20260519/F2026051901-alpha.md",
    "docs/features/20260519/F2026051901-beta.md",
  ]);
});

withFixture([
  "docs/features/20260520/F2026051901-alpha.md",
], (rootDir) => {
  const issues = checkFeatureDocNumbering(rootDir);
  assert.strictEqual(issues.length, 1, "date directory mismatches should be reported");
  assert(issues[0].message.includes("所在日期目录与编号 F2026051901 不一致"), "date mismatch issue should name the mismatched prefix");
  assert.deepStrictEqual(issues[0].files, ["docs/features/20260520/F2026051901-alpha.md"]);
});

const issues = checkFeatureDocNumbering(process.cwd());

assert.deepStrictEqual(issues, [], `feature doc numbering issues:\n${issues.map((issue) => `${issue.message}\n${issue.files.join("\n")}`).join("\n")}`);

console.log("feature-doc-numbering tests passed");
