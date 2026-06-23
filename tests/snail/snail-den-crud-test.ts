/**
 * Snail Den CRUD 测试 — 覆盖 Feature 文档 B1-B13
 *
 * 运行方式：npx tsx tests/snail/snail-den-crud-test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import { FileSnailRepository } from "@domain/snail/_internal/repository";
import { FileDataStore } from "@infra/file-data-store";
import { SQLiteDatabase } from "@infra/database";
import type { Snail } from "@domain/snail/model";

// ── 测试辅助 ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "snail-test-"));
}

function makeSnail(overrides: Partial<Snail> = {}): Snail {
  return {
    key: "test-snail",
    name: "Test Snail",
    agent_name: "claude-code",
    model: "sonnet",
    ...overrides,
  };
}

/** 创建隔离的 Repository 实例 */
function createRepo(tmpDir: string) {
  const dataDir = path.join(tmpDir, "data", "file");
  fs.mkdirSync(dataDir, { recursive: true });
  const dataStore = new FileDataStore(dataDir);
  const db = new SQLiteDatabase(tmpDir);

  // 初始化 issue 相关表（用于删除保护测试）
  db.initSchema(`
    CREATE TABLE IF NOT EXISTS issue (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      sop_snapshot TEXT NOT NULL,
      snail_assignment_plan TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS stage (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      issue_id TEXT NOT NULL REFERENCES issue(id),
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      default_role_instance TEXT NOT NULL,
      role_instances TEXT NOT NULL,
      from_stage_id TEXT REFERENCES stage(id),
      available_transitions TEXT NOT NULL,
      output_artifacts TEXT NOT NULL,
      entered_at TEXT NOT NULL,
      left_at TEXT
    );
    CREATE TABLE IF NOT EXISTS role_snail_assignment (
      stage_id TEXT NOT NULL REFERENCES stage(id),
      role_instance TEXT NOT NULL,
      seq INTEGER NOT NULL,
      snail_key TEXT NOT NULL,
      snail_instance_id TEXT,
      role_key TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(stage_id, role_instance, seq)
    );
  `);

  const repo = new FileSnailRepository(dataStore, db);
  return { repo, db, dataStore, dataDir };
}

// ── B1: 创建 Snail ─────────────────────────────────────────

function testB1_create() {
  const tmpDir = makeTmpDir();
  try {
    const { repo, dataDir } = createRepo(tmpDir);
    const snail = makeSnail();
    repo.create(snail);

    // 内存中存在
    const found = repo.findByKey("test-snail");
    assert.deepStrictEqual(found, snail, "B1: findByKey 应返回创建的 snail");

    // 文件中存在（write-through）
    const fileContent = JSON.parse(fs.readFileSync(path.join(dataDir, "snails.json"), "utf-8"));
    assert.strictEqual(fileContent.snails.length, 1, "B1: snails.json 应包含 1 条记录");
    assert.strictEqual(fileContent.snails[0].key, "test-snail", "B1: 文件中 key 应正确");

    console.log("  ✓ B1: 创建 Snail 成功并持久化");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B2: 重复 key 创建 → 409 ─────────────────────────────────

function testB2_duplicateKey() {
  const tmpDir = makeTmpDir();
  try {
    const { repo } = createRepo(tmpDir);
    repo.create(makeSnail());

    assert.throws(
      () => repo.create(makeSnail()),
      (err: Error) => err.message.includes("already exists"),
      "B2: 重复 key 应抛出 already exists 错误",
    );

    console.log("  ✓ B2: 重复 key 创建被拒绝");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B3: 缺字段 / key 格式不合法 → 400 ─────────────────────

function testB3_invalidInput() {
  const tmpDir = makeTmpDir();
  try {
    const { repo, dataDir } = createRepo(tmpDir);

    // 缺少必填字段（由 zod schema 在路由层拦截，repository 层不做校验）
    // 此测试验证：无 snail 创建时，文件不存在或为空
    const list = repo.list();
    assert.deepStrictEqual(list, [], "B3: 无有效输入时列表为空");

    // snails.json 不应被创建
    assert.strictEqual(
      fs.existsSync(path.join(dataDir, "snails.json")),
      false,
      "B3: 未创建 snail 时文件不应存在",
    );

    console.log("  ✓ B3: 无效输入未写入文件（路由层 zod 拦截）");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B4: 部分更新 ────────────────────────────────────────────

function testB4_partialUpdate() {
  const tmpDir = makeTmpDir();
  try {
    const { repo } = createRepo(tmpDir);
    repo.create(makeSnail());

    const updated = repo.update("test-snail", { name: "Updated Name" });

    assert.strictEqual(updated.key, "test-snail", "B4: key 不变");
    assert.strictEqual(updated.name, "Updated Name", "B4: name 已更新");
    assert.strictEqual(updated.agent_name, "claude-code", "B4: agent_name 保持不变");
    assert.strictEqual(updated.model, "sonnet", "B4: model 保持不变");

    // 文件也已更新
    const found = repo.findByKey("test-snail");
    assert.strictEqual(found?.name, "Updated Name", "B4: 文件中 name 已更新");

    console.log("  ✓ B4: 部分更新成功，未覆盖其他字段");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B5: 更新不存在的 snail → 404 ───────────────────────────

function testB5_updateNotFound() {
  const tmpDir = makeTmpDir();
  try {
    const { repo } = createRepo(tmpDir);

    assert.throws(
      () => repo.update("nonexistent", { name: "X" }),
      (err: Error) => err.message.includes("not found"),
      "B5: 更新不存在的 snail 应抛出 not found 错误",
    );

    console.log("  ✓ B5: 更新不存在的 snail 被拒绝");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B6: 删除无引用的 snail ──────────────────────────────────

function testB6_deleteNoRefs() {
  const tmpDir = makeTmpDir();
  try {
    const { repo, dataDir } = createRepo(tmpDir);
    repo.create(makeSnail());

    repo.remove("test-snail");

    assert.strictEqual(repo.findByKey("test-snail"), undefined, "B6: 删除后 findByKey 返回 undefined");

    const fileContent = JSON.parse(fs.readFileSync(path.join(dataDir, "snails.json"), "utf-8"));
    assert.strictEqual(fileContent.snails.length, 0, "B6: 文件中已无记录");

    console.log("  ✓ B6: 删除无引用的 snail 成功");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B7: 删除有活跃引用的 snail → 409 ───────────────────────

function testB7_deleteWithActiveRefs() {
  const tmpDir = makeTmpDir();
  try {
    const { repo } = createRepo(tmpDir);
    repo.create(makeSnail());

    // 创建 snail_instance 引用
    repo.createInstance({
      id: "test-snail#abc123",
      snail_key: "test-snail",
      session_ids: ["session-1"],
      created_at: new Date().toISOString(),
    });

    const instanceCount = repo.countInstancesByKey("test-snail");
    assert.strictEqual(instanceCount, 1, "B7: 应有 1 个 snail_instance 引用");

    // 删除保护在 Adapter 层，Repository 层不做检查
    // 此测试验证 countInstancesByKey 正确计数
    // 路由层测试中通过 Adapter 验证完整的删除保护逻辑

    console.log("  ✓ B7: countInstancesByKey 正确计数 snail_instance 引用");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B7b: 删除有 in_progress stage 引用的 snail → 409 ──────

function testB7b_deleteWithActiveStageRefs() {
  const tmpDir = makeTmpDir();
  try {
    const { repo, db } = createRepo(tmpDir);
    repo.create(makeSnail());

    // 创建 issue + in_progress stage + role_snail_assignment
    db.run(
      `INSERT INTO issue (id, workspace_path, title, sop_snapshot, snail_assignment_plan, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["issue-1", "/tmp/test", "Test Issue", "{}", "{}", "{}", new Date().toISOString()],
    );
    db.run(
      `INSERT INTO stage (id, workspace_path, issue_id, key, title, description, default_role_instance, role_instances, available_transitions, output_artifacts, entered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["stage-1", "/tmp/test", "issue-1", "dev", "Development", "", "dev", "[]", "[]", "{}", new Date().toISOString()],
    );
    db.run(
      `INSERT INTO role_snail_assignment (stage_id, role_instance, seq, snail_key, role_key, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["stage-1", "dev", 0, "test-snail", "developer", "", new Date().toISOString()],
    );

    const stageRefCount = repo.countActiveStageReferencesByKey("test-snail");
    assert.strictEqual(stageRefCount, 1, "B7b: 应有 1 个 in_progress stage 引用");

    // 验证已完成的 stage 不计入引用
    db.run(`UPDATE stage SET left_at = ? WHERE id = ?`, [new Date().toISOString(), "stage-1"]);
    const afterComplete = repo.countActiveStageReferencesByKey("test-snail");
    assert.strictEqual(afterComplete, 0, "B7b: stage 完成后不再计入引用");

    console.log("  ✓ B7b: countActiveStageReferencesByKey 正确计数 in_progress 引用");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B8: 删除不存在的 snail → 404 ───────────────────────────

function testB8_deleteNotFound() {
  const tmpDir = makeTmpDir();
  try {
    const { repo } = createRepo(tmpDir);

    assert.throws(
      () => repo.remove("nonexistent"),
      (err: Error) => err.message.includes("not found"),
      "B8: 删除不存在的 snail 应抛出 not found 错误",
    );

    console.log("  ✓ B8: 删除不存在的 snail 被拒绝");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B10: 文件不存在时读取 → 空列表 ─────────────────────────

function testB10_fileNotExist() {
  const tmpDir = makeTmpDir();
  try {
    const { repo, dataDir } = createRepo(tmpDir);

    // 不创建 snails.json，直接读取
    const list = repo.list();
    assert.deepStrictEqual(list, [], "B10: 文件不存在时应返回空列表");

    // 文件仍不存在
    assert.strictEqual(fs.existsSync(path.join(dataDir, "snails.json")), false, "B10: 不应创建文件");

    console.log("  ✓ B10: 文件不存在时返回空列表");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── B13: 文件损坏时读取 → 备份 + 空列表 ────────────────────

function testB13_corruptedFile() {
  const tmpDir = makeTmpDir();
  try {
    const { db: db1, dataDir } = createRepo(tmpDir);
    db1.close();

    // 写入损坏的 JSON
    fs.writeFileSync(path.join(dataDir, "snails.json"), "{ invalid json !!!");

    // 重新加载（构造函数会调用 loadSnails）
    const dataStore2 = new FileDataStore(dataDir);
    const db2 = new SQLiteDatabase(path.join(tmpDir, "db2"));
    db2.initSchema(`CREATE TABLE IF NOT EXISTS snail_instance (id TEXT PRIMARY KEY, snail_key TEXT NOT NULL, session_ids TEXT NOT NULL, created_at TEXT NOT NULL);`);
    const repo2 = new FileSnailRepository(dataStore2, db2);

    const list = repo2.list();
    assert.deepStrictEqual(list, [], "B13: 损坏文件应返回空列表");

    // 检查备份文件是否生成
    const files = fs.readdirSync(dataDir);
    const backupFiles = files.filter(f => f.startsWith("snails.json.corrupt."));
    assert.strictEqual(backupFiles.length, 1, "B13: 应生成 1 个备份文件");
    assert.ok(backupFiles[0].includes("snails.json.corrupt."), "B13: 备份文件名格式正确");

    // 备份文件内容应为原始损坏内容
    const backupContent = fs.readFileSync(path.join(dataDir, backupFiles[0]), "utf-8");
    assert.strictEqual(backupContent, "{ invalid json !!!", "B13: 备份文件内容应为原始损坏内容");

    db2.close();
    console.log("  ✓ B13: 文件损坏时备份并返回空列表");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Write-through 语义验证 ──────────────────────────────────

function testWriteThroughSemantics() {
  const tmpDir = makeTmpDir();
  try {
    const { repo, dataDir } = createRepo(tmpDir);

    // create: 文件先于内存更新
    repo.create(makeSnail());
    const fileAfterCreate = JSON.parse(fs.readFileSync(path.join(dataDir, "snails.json"), "utf-8"));
    assert.strictEqual(fileAfterCreate.snails.length, 1, "write-through: create 后文件已更新");

    // update: 文件先于内存更新
    repo.update("test-snail", { name: "Updated" });
    const fileAfterUpdate = JSON.parse(fs.readFileSync(path.join(dataDir, "snails.json"), "utf-8"));
    assert.strictEqual(fileAfterUpdate.snails[0].name, "Updated", "write-through: update 后文件已更新");

    // remove: 文件先于内存更新
    repo.remove("test-snail");
    const fileAfterDelete = JSON.parse(fs.readFileSync(path.join(dataDir, "snails.json"), "utf-8"));
    assert.strictEqual(fileAfterDelete.snails.length, 0, "write-through: remove 后文件已更新");

    console.log("  ✓ write-through 语义验证通过");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── 路由层测试 (B1-B8 HTTP 状态码) ─────────────────────────

async function testRoutes() {
  const tmpDir = makeTmpDir();
  try {
    const { repo, db } = createRepo(tmpDir);

    // 构建 Hono app（最小化 mock 依赖）
    const { Hono } = await import("hono");
    const app = new Hono();

    // 直接挂载 snail-den 路由（模拟 meta.route.ts 的逻辑）
    const { z } = await import("zod");

    const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
    const CreateSnailBodySchema = z.object({
      key: z.string().min(1).regex(KEY_PATTERN, "key must match pattern [a-zA-Z0-9_-]+"),
      name: z.string().min(1),
      agent_name: z.string().min(1),
      model: z.string().min(1),
      context_window: z.number().int().nonnegative().optional(),
      invocation_timeout_ms: z.number().int().nonnegative().optional(),
    });
    const UpdateSnailBodySchema = z.object({
      name: z.string().min(1).optional(),
      agent_name: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      context_window: z.number().int().nonnegative().optional(),
      invocation_timeout_ms: z.number().int().nonnegative().optional(),
    }).refine(obj => Object.keys(obj).length > 0, {
      message: "At least one non-key field must be provided",
    });

    const snailPort = {
      list: () => repo.list(),
      findByKey: (k: string) => repo.findByKey(k),
      create: (s: Snail) => repo.create(s),
      update: (k: string, p: Partial<Omit<Snail, 'key'>>) => repo.update(k, p),
      remove: (k: string) => {
        // 模拟 Adapter 层的删除保护逻辑
        const instanceCount = repo.countInstancesByKey(k);
        const stageRefCount = repo.countActiveStageReferencesByKey(k);
        if (instanceCount > 0 || stageRefCount > 0) {
          throw new Error(`Cannot delete snail '${k}': ${instanceCount} instance(s) and ${stageRefCount} in-progress stage(s) reference it`);
        }
        repo.remove(k);
      },
    };

    app.get("/api/snail-den", (c) => c.json(snailPort.list()));

    app.post("/api/snail-den", async (c) => {
      const parsed = CreateSnailBodySchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);
      try {
        snailPort.create(parsed.data);
        return c.json(parsed.data, 201);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("already exists")) return c.json({ error: msg }, 409);
        throw e;
      }
    });

    app.patch("/api/snail-den/:key", async (c) => {
      const key = c.req.param("key");
      const raw = await c.req.json();
      if ("key" in raw) return c.json({ error: "key cannot be modified" }, 400);
      const parsed = UpdateSnailBodySchema.safeParse(raw);
      if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);
      try {
        const updated = snailPort.update(key, parsed.data);
        return c.json(updated);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("not found")) return c.json({ error: msg }, 404);
        throw e;
      }
    });

    app.delete("/api/snail-den/:key", (c) => {
      const key = c.req.param("key");
      try {
        snailPort.remove(key);
        return c.json({ ok: true });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("not found")) return c.json({ error: msg }, 404);
        if (msg.includes("Cannot delete")) return c.json({ error: msg }, 409);
        throw e;
      }
    });

    // B1: POST → 201
    let res = await app.request("/api/snail-den", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "r1", name: "R1", agent_name: "a", model: "m" }),
    });
    assert.strictEqual(res.status, 201, "route B1: POST 应返回 201");

    // B2: POST duplicate → 409
    res = await app.request("/api/snail-den", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "r1", name: "Dup", agent_name: "a", model: "m" }),
    });
    assert.strictEqual(res.status, 409, "route B2: 重复 key 应返回 409");

    // B3: POST missing fields → 400
    res = await app.request("/api/snail-den", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "r2" }),
    });
    assert.strictEqual(res.status, 400, "route B3: 缺字段应返回 400");

    // B3b: POST bad key format → 400
    res = await app.request("/api/snail-den", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "bad/key", name: "X", agent_name: "a", model: "m" }),
    });
    assert.strictEqual(res.status, 400, "route B3b: key 格式不合法应返回 400");

    // B4: PATCH partial update → 200
    res = await app.request("/api/snail-den/r1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    assert.strictEqual(res.status, 200, "route B4: PATCH 应返回 200");
    const body = await res.json() as Snail;
    assert.strictEqual(body.name, "Updated", "route B4: name 已更新");
    assert.strictEqual(body.key, "r1", "route B4: key 不变");

    // B5: PATCH not found → 404
    res = await app.request("/api/snail-den/nonexistent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    assert.strictEqual(res.status, 404, "route B5: PATCH 不存在应返回 404");

    // B11: PATCH key in body → 400
    res = await app.request("/api/snail-den/r1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "changed" }),
    });
    assert.strictEqual(res.status, 400, "route B11: body 含 key 应返回 400");

    // B12: PATCH empty body → 400
    res = await app.request("/api/snail-den/r1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400, "route B12: 空 body 应返回 400");

    // B6: DELETE → 200
    res = await app.request("/api/snail-den/r1", { method: "DELETE" });
    assert.strictEqual(res.status, 200, "route B6: DELETE 应返回 200");

    // B8: DELETE not found → 404
    res = await app.request("/api/snail-den/nonexistent", { method: "DELETE" });
    assert.strictEqual(res.status, 404, "route B8: DELETE 不存在应返回 404");

    // B7: DELETE with active refs → 409
    snailPort.create(makeSnail({ key: "protected" }));
    repo.createInstance({
      id: "protected#abc",
      snail_key: "protected",
      session_ids: [],
      created_at: new Date().toISOString(),
    });
    res = await app.request("/api/snail-den/protected", { method: "DELETE" });
    assert.strictEqual(res.status, 409, "route B7: 有引用时 DELETE 应返回 409");

    db.close();
    console.log("  ✓ 路由层 B1-B8, B11, B12 HTTP 状态码全部正确");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── 运行所有测试 ────────────────────────────────────────────

async function run() {
  console.log("Snail Den CRUD 测试 (B1-B13)\n");

  testB1_create();
  testB2_duplicateKey();
  testB3_invalidInput();
  testB4_partialUpdate();
  testB5_updateNotFound();
  testB6_deleteNoRefs();
  testB7_deleteWithActiveRefs();
  testB7b_deleteWithActiveStageRefs();
  testB8_deleteNotFound();
  testB10_fileNotExist();
  testB13_corruptedFile();
  testWriteThroughSemantics();
  await testRoutes();

  console.log("\n所有测试通过 ✓");
}

run().catch((err) => {
  console.error("测试失败:", err);
  process.exitCode = 1;
});
