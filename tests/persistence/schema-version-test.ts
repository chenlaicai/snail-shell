import { getSchemaVersion } from "../../src/persistence/schema";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-version-test-"));
const schemaDir = path.join(tmpDir, "src", "persistence");
fs.mkdirSync(schemaDir, { recursive: true });
fs.writeFileSync(path.join(schemaDir, "schema.ts"), "// schema v1");
execSync("git init", { cwd: tmpDir });
execSync("git config user.email test@test", { cwd: tmpDir });
execSync("git config user.name test", { cwd: tmpDir });
execSync("git add src/persistence/schema.ts", { cwd: tmpDir });
execSync("git commit -m init", { cwd: tmpDir });

const originalCwd = process.cwd();

try {
  // 1. normal path: valid git repo → returns "short_hash YYYY-MM-DD"
  process.chdir(tmpDir);
  const version = getSchemaVersion();
  assert(
    /^[0-9a-f]{7} \d{4}-\d{2}-\d{2}$/.test(version),
    `正常路径应返回 "short_hash YYYY-MM-DD" 格式，实际: "${version}"`,
  );

  // 2. no git repo → "UNKNOWN"
  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-version-no-git-"));
  process.chdir(nonGitDir);
  const noGitVersion = getSchemaVersion();
  assert(
    noGitVersion === "UNKNOWN",
    `无 git 环境应 fallback 为 "UNKNOWN"，实际: "${noGitVersion}"`,
  );
  fs.rmSync(nonGitDir, { recursive: true, force: true });

  // 3. must not throw to caller
  let threw = false;
  try {
    getSchemaVersion();
  } catch {
    threw = true;
  }
  assert(!threw, "getSchemaVersion 不得向启动流程抛错");
} finally {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("schema version tests passed");
