/**
 * Feature 文档编号校验测试 — 覆盖新旧格式兼容、碰撞检测、边界情况
 *
 * 运行方式：npx tsx tests/feature-numbering-test.ts
 */

import fs from "fs";
import path from "path";
import os from "os";
import { checkFeatureDocNumbering, FeatureDocNumberingIssue } from "../scripts/check-issue-doc-numbering";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertIssue(issues: FeatureDocNumberingIssue[], expectedMsg: string) {
  const found = issues.some((i) => i.message.includes(expectedMsg));
  assert(found, `检测到问题: "${expectedMsg}"`);
}

function assertNoIssue(issues: FeatureDocNumberingIssue[], unexpectedMsg: string) {
  const found = issues.some((i) => i.message.includes(unexpectedMsg));
  assert(!found, `不应有问题: "${unexpectedMsg}"`);
}

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "feature-numbering-test-"));
}

function createFeatureDoc(rootDir: string, datePath: string, fileName: string, id: string) {
  const dir = path.join(rootDir, "docs", "features", ...datePath.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  const content = `---\nid: ${id}\ntitle: test\nfrom_ids: []\ntags: []\nmodules: []\ndoc_kind: spec\n---\n\n# ${id} [test] Test\n`;
  fs.writeFileSync(path.join(dir, fileName), content);
}

// ─── 测试 1：旧格式正常通过 ───
console.log("\n测试 1：旧格式 FYYYYMMDDNN 正常通过");
{
  const tmp = createTmpDir();
  createFeatureDoc(tmp, "2026/06/22", "F2026062201-test-a.md", "F2026062201");
  createFeatureDoc(tmp, "2026/06/22", "F2026062202-test-b.md", "F2026062202");
  const issues = checkFeatureDocNumbering(tmp);
  assert(issues.length === 0, "两个旧格式文件无问题");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 2：新格式正常通过 ───
console.log("\n测试 2：新格式 FYYYYMMDDxxxx 正常通过");
{
  const tmp = createTmpDir();
  createFeatureDoc(tmp, "2026/06/23", "F202606238vkw-test-a.md", "F202606238vkw");
  createFeatureDoc(tmp, "2026/06/23", "F20260623ab2d-test-b.md", "F20260623ab2d");
  const issues = checkFeatureDocNumbering(tmp);
  assert(issues.length === 0, "两个新格式文件无问题");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 3：新旧格式混合共存 ───
console.log("\n测试 3：新旧格式混合共存");
{
  const tmp = createTmpDir();
  createFeatureDoc(tmp, "2026/06/22", "F2026062201-test-a.md", "F2026062201");
  createFeatureDoc(tmp, "2026/06/23", "F202606238vkw-test-b.md", "F202606238vkw");
  const issues = checkFeatureDocNumbering(tmp);
  assert(issues.length === 0, "不同日期的新旧格式文件无问题");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 4：旧格式重复编号检测 ───
console.log("\n测试 4：旧格式重复编号检测");
{
  const tmp = createTmpDir();
  createFeatureDoc(tmp, "2026/06/22", "F2026062201-test-a.md", "F2026062201");
  createFeatureDoc(tmp, "2026/06/22", "F2026062201-test-b.md", "F2026062201");
  const issues = checkFeatureDocNumbering(tmp);
  assertIssue(issues, "重复编号");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 5：新格式同日同随机码碰撞检测 ───
console.log("\n测试 5：新格式同日同随机码碰撞检测");
{
  const tmp = createTmpDir();
  createFeatureDoc(tmp, "2026/06/23", "F202606238vkw-test-a.md", "F202606238vkw");
  createFeatureDoc(tmp, "2026/06/23", "F202606238vkw-test-b.md", "F202606238vkw");
  const issues = checkFeatureDocNumbering(tmp);
  assertIssue(issues, "重复编号");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 6：新格式不同日不碰撞 ───
console.log("\n测试 6：新格式不同日同随机码不碰撞");
{
  const tmp = createTmpDir();
  createFeatureDoc(tmp, "2026/06/23", "F202606238vkw-test-a.md", "F202606238vkw");
  createFeatureDoc(tmp, "2026/06/24", "F202606248vkw-test-b.md", "F202606248vkw");
  const issues = checkFeatureDocNumbering(tmp);
  assertNoIssue(issues, "碰撞");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 7：日期目录不一致检测 ───
console.log("\n测试 7：日期目录与编号日期不一致检测");
{
  const tmp = createTmpDir();
  // File in 2026/06/23 but ID says 2026/06/22
  createFeatureDoc(tmp, "2026/06/23", "F2026062201-test-a.md", "F2026062201");
  const issues = checkFeatureDocNumbering(tmp);
  assertIssue(issues, "日期目录");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 8：缺少 frontmatter 检测 ───
console.log("\n测试 8：缺少 frontmatter 检测");
{
  const tmp = createTmpDir();
  const dir = path.join(tmp, "docs", "features", "2026", "06", "23");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "F202606238vkw-no-fm.md"), "# No frontmatter\n");
  const issues = checkFeatureDocNumbering(tmp);
  assertIssue(issues, "缺少 YAML frontmatter");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 9：缺少 id 字段检测 ───
console.log("\n测试 9：缺少 id 字段检测");
{
  const tmp = createTmpDir();
  const dir = path.join(tmp, "docs", "features", "2026", "06", "23");
  fs.mkdirSync(dir, { recursive: true });
  const content = `---\ntitle: no-id\n---\n\n# No ID\n`;
  fs.writeFileSync(path.join(dir, "F202606238vkw-no-id.md"), content);
  const issues = checkFeatureDocNumbering(tmp);
  assertIssue(issues, "缺少 id 字段");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 测试 10：非 F 开头文件忽略 ───
console.log("\n测试 10：非 F 开头文件忽略");
{
  const tmp = createTmpDir();
  const dir = path.join(tmp, "docs", "features", "2026", "06", "23");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# Not a feature doc\n");
  const issues = checkFeatureDocNumbering(tmp);
  assert(issues.length === 0, "非 F 开头文件被忽略");
  fs.rmSync(tmp, { recursive: true });
}

// ─── 汇总 ───
console.log(`\n${"=".repeat(40)}`);
console.log(`通过: ${passed}  失败: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
