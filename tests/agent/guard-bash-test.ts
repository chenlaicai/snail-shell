/**
 * guard-bash.js 行为测试
 *
 * 通过 spawn 子进程测试 hook 对各种命令的判定。
 * 覆盖：
 * - 危险 sqlite 写入被拒（database.mode=deny 默认）
 * - 安全 sqlite 只读放行
 * - database.mode=allow 时数据库操作放行
 * - rm -rf / 被拒（硬底线，不受 mode 影响）
 * - chmod 777 被拒
 * - git push --force main 被拒（硬底线）
 * - git reset --hard 被拒
 * - 安全命令放行
 * - 非 Bash 工具调用放行
 * - 空命令放行
 * - 非法 JSON 输入放行（保守）
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const HOOK_PATH = path.join(process.cwd(), ".meta", "hooks", "guard-bash.js");

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

interface GuardResult {
  decision: string;
  reason?: string;
}

function runGuard(command: string, toolName = "Bash"): GuardResult {
  const input = JSON.stringify({ tool_name: toolName, tool_input: { command } });
  const result = spawnSync("node", [HOOK_PATH], {
    input,
    encoding: "utf-8",
    timeout: 5000,
  });
  if (result.error) throw result.error;
  return JSON.parse(result.stdout.trim()) as GuardResult;
}

// ──── 数据库写操作被拒 ────

function testSqliteInsertDenied(): void {
  const r = runGuard("sqlite3 data/snail-shell.db \"INSERT INTO project VALUES ('x')\"");
  assert(r.decision === "deny", "sqlite3 INSERT should be denied");
  assert(r.reason?.includes("数据库写操作"), "reason should mention database write");
  console.log("✓ testSqliteInsertDenied passed");
}

function testSqliteUpdateDenied(): void {
  const r = runGuard("sqlite3 data/test.db \"UPDATE users SET name='x' WHERE id=1\"");
  assert(r.decision === "deny", "sqlite3 UPDATE should be denied");
  console.log("✓ testSqliteUpdateDenied passed");
}

function testSqliteDeleteDenied(): void {
  const r = runGuard("sqlite3 db.sqlite \"DELETE FROM messages WHERE id=1\"");
  assert(r.decision === "deny", "sqlite3 DELETE should be denied");
  console.log("✓ testSqliteDeleteDenied passed");
}

function testSqliteDropTableDenied(): void {
  const r = runGuard("sqlite3 data.db \"DROP TABLE users\"");
  assert(r.decision === "deny", "sqlite3 DROP TABLE should be denied");
  console.log("✓ testSqliteDropTableDenied passed");
}

function testSqliteAlterTableDenied(): void {
  const r = runGuard("sqlite3 data.db \"ALTER TABLE users ADD COLUMN age INT\"");
  assert(r.decision === "deny", "sqlite3 ALTER TABLE should be denied");
  console.log("✓ testSqliteAlterTableDenied passed");
}

function testSqliteCreateTableDenied(): void {
  const r = runGuard("sqlite3 data.db \"CREATE TABLE test (id INT)\"");
  assert(r.decision === "deny", "sqlite3 CREATE TABLE should be denied");
  console.log("✓ testSqliteCreateTableDenied passed");
}

function testPsqlInsertDenied(): void {
  const r = runGuard("psql -d mydb -c \"INSERT INTO users VALUES (1)\"");
  assert(r.decision === "deny", "psql INSERT should be denied");
  console.log("✓ testPsqlInsertDenied passed");
}

function testMysqlDeleteDenied(): void {
  const r = runGuard("mysql -u root -e \"DELETE FROM logs WHERE created_at < '2020-01-01'\"");
  assert(r.decision === "deny", "mysql DELETE should be denied");
  console.log("✓ testMysqlDeleteDenied passed");
}

function testNonReadOnlyPragmaDenied(): void {
  const r = runGuard("sqlite3 data.db \"PRAGMA journal_mode=WAL\"");
  assert(r.decision === "deny", "non-read-only PRAGMA should be denied");
  console.log("✓ testNonReadOnlyPragmaDenied passed");
}

// ──── sqlite 只读操作放行 ────

function testSqliteSelectAllowed(): void {
  const r = runGuard("sqlite3 data/snail-shell.db \"SELECT * FROM project\"");
  assert(r.decision === "allow", "sqlite3 SELECT should be allowed");
  console.log("✓ testSqliteSelectAllowed passed");
}

function testSqliteDotSchemaAllowed(): void {
  const r = runGuard("sqlite3 data/snail-shell.db .schema");
  assert(r.decision === "allow", "sqlite3 .schema should be allowed");
  console.log("✓ testSqliteDotSchemaAllowed passed");
}

function testSqliteDotDumpAllowed(): void {
  const r = runGuard("sqlite3 data/snail-shell.db .dump");
  assert(r.decision === "allow", "sqlite3 .dump should be allowed");
  console.log("✓ testSqliteDotDumpAllowed passed");
}

function testSqliteDotTablesAllowed(): void {
  const r = runGuard("sqlite3 data/snail-shell.db .tables");
  assert(r.decision === "allow", "sqlite3 .tables should be allowed");
  console.log("✓ testSqliteDotTablesAllowed passed");
}

function testSqliteReadOnlyPragmaAllowed(): void {
  const r = runGuard("sqlite3 data.db \"PRAGMA table_info(users)\"");
  assert(r.decision === "allow", "read-only PRAGMA should be allowed");
  console.log("✓ testSqliteReadOnlyPragmaAllowed passed");
}

function testSqliteIntegrityCheckAllowed(): void {
  const r = runGuard("sqlite3 data.db \"PRAGMA integrity_check\"");
  assert(r.decision === "allow", "PRAGMA integrity_check should be allowed");
  console.log("✓ testSqliteIntegrityCheckAllowed passed");
}

// ──── sqlite 直接数据库文件访问（无明确只读命令） ────

function testSqliteRawDbAccessDenied(): void {
  const r = runGuard("sqlite3 data/snail-shell.db");
  assert(r.decision === "deny", "sqlite3 direct DB access without read-only command should be denied");
  assert(r.reason?.includes("直接访问数据库文件"), "reason should mention direct DB access");
  console.log("✓ testSqliteRawDbAccessDenied passed");
}

// ──── 危险文件系统操作 ────

function testRmRfRootDenied(): void {
  const r = runGuard("rm -rf /");
  assert(r.decision === "deny", "rm -rf / should be denied");
  console.log("✓ testRmRfRootDenied passed");
}

function testChmod777Denied(): void {
  const r = runGuard("chmod 777 /usr/local/bin/something");
  assert(r.decision === "deny", "chmod 777 should be denied");
  console.log("✓ testChmod777Denied passed");
}

function testChmodSuidDenied(): void {
  const r = runGuard("chmod 4777 /tmp/exploit");
  assert(r.decision === "deny", "chmod 4777 should be denied");
  console.log("✓ testChmodSuidDenied passed");
}

// ──── 危险 Git 操作 ────

function testGitForcePushMainDenied(): void {
  const r = runGuard("git push origin main --force");
  assert(r.decision === "deny", "git push --force main should be denied");
  console.log("✓ testGitForcePushMainDenied passed");
}

function testGitForcePushMasterDenied(): void {
  const r = runGuard("git push --force origin master");
  assert(r.decision === "deny", "git push --force master should be denied");
  console.log("✓ testGitForcePushMasterDenied passed");
}

function testGitResetHardDenied(): void {
  const r = runGuard("git reset --hard HEAD~1");
  assert(r.decision === "deny", "git reset --hard should be denied");
  console.log("✓ testGitResetHardDenied passed");
}

function testGitCleanFdxDenied(): void {
  const r = runGuard("git clean -fdx");
  assert(r.decision === "deny", "git clean -fdx should be denied");
  console.log("✓ testGitCleanFdxDenied passed");
}

// ──── 安全命令放行 ────

function testLsAllowed(): void {
  const r = runGuard("ls -la");
  assert(r.decision === "allow", "ls should be allowed");
  console.log("✓ testLsAllowed passed");
}

function testNpmTestAllowed(): void {
  const r = runGuard("npm test");
  assert(r.decision === "allow", "npm test should be allowed");
  console.log("✓ testNpmTestAllowed passed");
}

function testGitStatusAllowed(): void {
  const r = runGuard("git status");
  assert(r.decision === "allow", "git status should be allowed");
  console.log("✓ testGitStatusAllowed passed");
}

function testGitDiffAllowed(): void {
  const r = runGuard("git diff");
  assert(r.decision === "allow", "git diff should be allowed");
  console.log("✓ testGitDiffAllowed passed");
}

function testGitPushNonForceAllowed(): void {
  const r = runGuard("git push origin feature-branch");
  assert(r.decision === "allow", "git push (non-force) should be allowed");
  console.log("✓ testGitPushNonForceAllowed passed");
}

function testCurlAllowed(): void {
  const r = runGuard("curl -s https://api.github.com");
  assert(r.decision === "allow", "curl should be allowed");
  console.log("✓ testCurlAllowed passed");
}

function testEchoAllowed(): void {
  const r = runGuard("echo hello world");
  assert(r.decision === "allow", "echo should be allowed");
  console.log("✓ testEchoAllowed passed");
}

// ──── 边界情况 ────

function testNonBashToolAllowed(): void {
  const input = JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/tmp/test" } });
  const result = spawnSync("node", [HOOK_PATH], {
    input,
    encoding: "utf-8",
    timeout: 5000,
  });
  const r = JSON.parse(result.stdout.trim()) as GuardResult;
  assert(r.decision === "allow", "non-Bash tool should be allowed");
  console.log("✓ testNonBashToolAllowed passed");
}

function testEmptyCommandAllowed(): void {
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "" } });
  const result = spawnSync("node", [HOOK_PATH], {
    input,
    encoding: "utf-8",
    timeout: 5000,
  });
  const r = JSON.parse(result.stdout.trim()) as GuardResult;
  assert(r.decision === "allow", "empty command should be allowed");
  console.log("✓ testEmptyCommandAllowed passed");
}

function testInvalidJsonAllowed(): void {
  const result = spawnSync("node", [HOOK_PATH], {
    input: "not valid json",
    encoding: "utf-8",
    timeout: 5000,
  });
  const r = JSON.parse(result.stdout.trim()) as GuardResult;
  assert(r.decision === "allow", "invalid JSON should be conservatively allowed");
  console.log("✓ testInvalidJsonAllowed passed");
}

// ──── database.mode=allow：数据库规则应放行 ────

function runGuardInCwd(command: string, cwd: string, toolName = "Bash"): GuardResult {
  const input = JSON.stringify({ tool_name: toolName, tool_input: { command } });
  const result = spawnSync("node", [HOOK_PATH], {
    input,
    encoding: "utf-8",
    timeout: 5000,
    cwd,
  });
  if (result.error) throw result.error;
  return JSON.parse(result.stdout.trim()) as GuardResult;
}

function setupGuardProfile(dir: string, databaseMode: string): void {
  const claudeDir = path.join(dir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "guard-profile.json"), JSON.stringify({
    database: { mode: databaseMode },
    filesystem: { mode: "allow" },
    network: { mode: "allow" },
    git: { mode: "allow" },
  }));
}

/**
 * database.mode=allow / filesystem/git 硬底线测试。
 * 在同一 temp dir 下验证：
 * - database.mode=allow 时数据库写操作放行
 * - database.mode=allow 时 sqlite 直接访问放行
 * - filesystem rm -rf / 仍然拒绝（硬底线）
 * - git reset --hard 仍然拒绝（硬底线）
 */
function testDatabaseAllowMode(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-bash-test-"));
  try {
    setupGuardProfile(tmpDir, "allow");

    // database.mode=allow → sqlite3 INSERT 放行
    let r = runGuardInCwd("sqlite3 data/snail-shell.db \"INSERT INTO project VALUES ('x')\"", tmpDir);
    assert(r.decision === "allow", "database.mode=allow: sqlite3 INSERT should be allowed");

    // database.mode=allow → sqlite3 DELETE 放行
    r = runGuardInCwd("sqlite3 data.db \"DELETE FROM messages WHERE id=1\"", tmpDir);
    assert(r.decision === "allow", "database.mode=allow: sqlite3 DELETE should be allowed");

    // database.mode=allow → psql INSERT 放行
    r = runGuardInCwd("psql -d mydb -c \"INSERT INTO users VALUES (1)\"", tmpDir);
    assert(r.decision === "allow", "database.mode=allow: psql INSERT should be allowed");

    // database.mode=allow → sqlite3 直接访问数据库文件 放行
    r = runGuardInCwd("sqlite3 data/snail-shell.db", tmpDir);
    assert(r.decision === "allow", "database.mode=allow: sqlite3 direct DB access should be allowed");

    // 硬底线：rm -rf / 仍然拒绝
    r = runGuardInCwd("rm -rf /", tmpDir);
    assert(r.decision === "deny", "hard floor: rm -rf / should still be denied even with database.mode=allow");

    // 硬底线：git reset --hard 仍然拒绝
    r = runGuardInCwd("git reset --hard HEAD~1", tmpDir);
    assert(r.decision === "deny", "hard floor: git reset --hard should still be denied even with database.mode=allow");

    // 硬底线：git push --force main 仍然拒绝
    r = runGuardInCwd("git push --force origin main", tmpDir);
    assert(r.decision === "deny", "hard floor: git push --force main should still be denied even with database.mode=allow");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testDatabaseAllowMode passed (7 assertions)");
}

/**
 * guard-profile.json 不存在时，数据库规则应生效（默认严格策略）。
 */
function testDatabaseMissingGuardProfileDefaultsToDeny(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-bash-test-"));
  try {
    // 不创建 guard-profile.json

    // 数据库写操作应被拒绝（无 guard-profile.json 时默认严格）
    const r = runGuardInCwd("sqlite3 data/snail-shell.db \"INSERT INTO project VALUES ('x')\"", tmpDir);
    assert(r.decision === "deny", "missing guard-profile.json: sqlite3 INSERT should be denied (default strict)");

    // 安全命令应放行
    const r2 = runGuardInCwd("ls -la", tmpDir);
    assert(r2.decision === "allow", "missing guard-profile.json: ls should be allowed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("✓ testDatabaseMissingGuardProfileDefaultsToDeny passed");
}

// ──── 运行 ────

// 数据库写操作
testSqliteInsertDenied();
testSqliteUpdateDenied();
testSqliteDeleteDenied();
testSqliteDropTableDenied();
testSqliteAlterTableDenied();
testSqliteCreateTableDenied();
testPsqlInsertDenied();
testMysqlDeleteDenied();
testNonReadOnlyPragmaDenied();

// 数据库只读
testSqliteSelectAllowed();
testSqliteDotSchemaAllowed();
testSqliteDotDumpAllowed();
testSqliteDotTablesAllowed();
testSqliteReadOnlyPragmaAllowed();
testSqliteIntegrityCheckAllowed();

// 直接数据库文件访问
testSqliteRawDbAccessDenied();

// 文件系统
testRmRfRootDenied();
testChmod777Denied();
testChmodSuidDenied();

// Git
testGitForcePushMainDenied();
testGitForcePushMasterDenied();
testGitResetHardDenied();
testGitCleanFdxDenied();

// 安全命令
testLsAllowed();
testNpmTestAllowed();
testGitStatusAllowed();
testGitDiffAllowed();
testGitPushNonForceAllowed();
testCurlAllowed();
testEchoAllowed();

// 边界
testNonBashToolAllowed();
testEmptyCommandAllowed();
testInvalidJsonAllowed();

// database.mode=allow
testDatabaseAllowMode();
testDatabaseMissingGuardProfileDefaultsToDeny();

console.log("\nguard-bash tests passed");
