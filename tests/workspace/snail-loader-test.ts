import fs from "fs";
import path from "path";
import { hasSnailDirectory, loadSnailConfig, convertSnailConfigToSeed, initializeSnailDirectory } from "../../src/workspace-workflow/snail-loader";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DIR = path.join(__dirname, "..", "..", "data", "test-snail-loader");
fs.mkdirSync(TEST_DIR, { recursive: true });

// 清理测试目录
function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// 测试 hasSnailDirectory
function testHasSnailDirectory() {
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // 不存在 .snail 目录时返回 false
  assert(!hasSnailDirectory(TEST_DIR), "should return false when .snail does not exist");

  // 创建 .snail 目录后返回 true
  fs.mkdirSync(path.join(TEST_DIR, ".snail"));
  assert(hasSnailDirectory(TEST_DIR), "should return true when .snail exists");

  // .snail 是文件时返回 false
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, ".snail"), "not a directory");
  assert(!hasSnailDirectory(TEST_DIR), "should return false when .snail is a file");

  cleanup();
  console.log("  ✓ testHasSnailDirectory passed");
}

// 测试 initializeSnailDirectory
function testInitializeSnailDirectory() {
  cleanup();

  const config = initializeSnailDirectory(TEST_DIR, { name: "Test Workspace", summary: "Test summary" });

  // 验证返回的配置
  assert(config.workspace.name === "Test Workspace", "workspace name should match");
  assert(config.workspace.summary === "Test summary", "workspace summary should match");
  assert(config.workspace.default_sop_key === "code-delivery", "default_sop_key should be code-delivery");
  assert(config.sops.length === 1, "should have one default SOP");
  assert(config.sops[0].key === "code-delivery", "default SOP key should be code-delivery");

  // 验证文件已创建
  assert(fs.existsSync(path.join(TEST_DIR, ".snail", "workspace.json")), "workspace.json should exist");
  assert(fs.existsSync(path.join(TEST_DIR, ".snail", "sop", "code-delivery.json")), "code-delivery.json should exist");

  // 验证文件内容
  const workspaceJson = JSON.parse(fs.readFileSync(path.join(TEST_DIR, ".snail", "workspace.json"), "utf8"));
  assert(workspaceJson.name === "Test Workspace", "workspace.json name should match");
  assert(workspaceJson.default_sop_key === "code-delivery", "workspace.json default_sop_key should match");

  const sopJson = JSON.parse(fs.readFileSync(path.join(TEST_DIR, ".snail", "sop", "code-delivery.json"), "utf8"));
  assert(sopJson.key === "code-delivery", "sop json key should match");
  assert(sopJson.role_definitions.length === 1, "sop should have one role definition");
  assert(sopJson.stage_definitions.length === 2, "sop should have two stage definitions");

  cleanup();
  console.log("  ✓ testInitializeSnailDirectory passed");
}

// 测试 loadSnailConfig
function testLoadSnailConfig() {
  cleanup();

  // 目录不存在时抛出异常
  try {
    loadSnailConfig(TEST_DIR);
    assert(false, "should throw when .snail does not exist");
  } catch (err) {
    assert(err instanceof Error && err.message.includes(".snail directory not found"), "should throw correct error");
  }

  // 初始化目录后加载
  initializeSnailDirectory(TEST_DIR, { name: "Load Test" });
  const config = loadSnailConfig(TEST_DIR);

  assert(config.workspace.name === "Load Test", "loaded workspace name should match");
  assert(config.sops.length === 1, "loaded sops should have one item");
  assert(config.sops[0].key === "code-delivery", "loaded sop key should match");

  // 验证 role_definitions 解析
  const sop = config.sops[0];
  assert(sop.role_definitions.length === 1, "should have one role definition");
  assert(sop.role_definitions[0].key === "developer", "role key should be developer");
  assert(sop.role_definitions[0].working_rules?.length === 2, "developer should have 2 working rules");

  // 验证 stage_definitions 解析
  assert(sop.stage_definitions.length === 2, "should have two stage definitions");
  assert(sop.stage_definitions[0].key === "development", "first stage should be development");
  assert(sop.stage_definitions[1].key === "review", "second stage should be review");
  assert(sop.stage_definitions[0].roles[0].role_key === "developer", "development stage should have developer role");

  cleanup();
  console.log("  ✓ testLoadSnailConfig passed");
}

// 测试 convertSnailConfigToSeed
function testConvertSnailConfigToSeed() {
  cleanup();
  initializeSnailDirectory(TEST_DIR, { name: "Seed Test" });
  const config = loadSnailConfig(TEST_DIR);

  const workspaceId = "test-workspace-id";
  const seed = convertSnailConfigToSeed(workspaceId, config);

  // 验证 sopSeeds
  assert(seed.sopSeeds.length === 1, "should have one sop seed");
  const sopSeed = seed.sopSeeds[0];
  assert(sopSeed.sop.id === `sop-${workspaceId}-code-delivery`, "sop id should be deterministic");
  assert(sopSeed.sop.scope === "workspace", "sop scope should be workspace");
  assert(sopSeed.sop.scope_ref === workspaceId, "sop scope_ref should be workspaceId");
  assert(sopSeed.role_definitions.length === 1, "should have one role definition");
  assert(sopSeed.stage_definitions.length === 2, "should have two stage definitions");

  // 验证 workspaceBindings
  assert(seed.workspaceBindings.length === 1, "should have one workspace binding");
  assert(seed.workspaceBindings[0].sop_id === sopSeed.sop.id, "binding sop_id should match");
  assert(seed.workspaceBindings[0].is_default === true, "should be default sop");

  // 验证确定性 ID
  const seed2 = convertSnailConfigToSeed(workspaceId, config);
  assert(seed2.sopSeeds[0].sop.id === seed.sopSeeds[0].sop.id, "sop id should be deterministic across calls");

  cleanup();
  console.log("  ✓ testConvertSnailConfigToSeed passed");
}

// 测试 workspace.json 缺少 name 字段
function testLoadSnailConfigMissingName() {
  cleanup();
  fs.mkdirSync(path.join(TEST_DIR, ".snail"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "workspace.json"), JSON.stringify({ summary: "no name" }));

  try {
    loadSnailConfig(TEST_DIR);
    assert(false, "should throw when name is missing");
  } catch (err) {
    assert(err instanceof Error && err.message.includes("must contain a string 'name' field"), "should throw correct error for missing name");
  }

  cleanup();
  console.log("  ✓ testLoadSnailConfigMissingName passed");
}

// 测试 SOP 文件格式错误
function testLoadSnailConfigInvalidSop() {
  cleanup();
  fs.mkdirSync(path.join(TEST_DIR, ".snail", "sop"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "workspace.json"), JSON.stringify({ name: "Test" }));
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "sop", "invalid.json"), JSON.stringify({ name: "No Key" }));

  try {
    loadSnailConfig(TEST_DIR);
    assert(false, "should throw when sop key is missing");
  } catch (err) {
    assert(err instanceof Error && err.message.includes("must contain a string 'key' field"), "should throw correct error for missing sop key");
  }

  cleanup();
  console.log("  ✓ testLoadSnailConfigInvalidSop passed");
}

// 测试 stage_definitions 引用不存在的 role_key
function testLoadSnailConfigInvalidRoleReference() {
  cleanup();
  fs.mkdirSync(path.join(TEST_DIR, ".snail", "sop"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "workspace.json"), JSON.stringify({ name: "Test" }));
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "sop", "test.json"), JSON.stringify({
    key: "test",
    name: "Test SOP",
    role_definitions: [{ key: "developer", name: "Developer" }],
    stage_definitions: [{
      key: "dev",
      title: "Development",
      sequence: 1,
      roles: [{ role_key: "nonexistent" }],
    }],
  }));

  try {
    loadSnailConfig(TEST_DIR);
    assert(false, "should throw when role_key does not exist");
  } catch (err) {
    assert(err instanceof Error && err.message.includes("does not match any role_definitions key"), "should throw correct error for invalid role reference");
  }

  cleanup();
  console.log("  ✓ testLoadSnailConfigInvalidRoleReference passed");
}

// 运行所有测试
console.log("Running snail-loader tests...");
testHasSnailDirectory();
testInitializeSnailDirectory();
testLoadSnailConfig();
testConvertSnailConfigToSeed();
testLoadSnailConfigMissingName();
testLoadSnailConfigInvalidSop();
testLoadSnailConfigInvalidRoleReference();
console.log("snail-loader tests passed");
