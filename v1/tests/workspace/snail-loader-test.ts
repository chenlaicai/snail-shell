import fs from "fs";
import os from "os";
import path from "path";
import { hasSnailDirectory, loadWorkspaceContext, initializeSnailDirectory } from "../../src/workspace-workflow/snail-loader";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "snail-loader-test-"));

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

  const context = initializeSnailDirectory(TEST_DIR, { name: "Test Workspace", summary: "Test summary" });

  // 验证返回的配置
  assert(context.config.name === "Test Workspace", "workspace name should match");
  assert(context.config.summary === "Test summary", "workspace summary should match");
  assert(context.sopDefinitions.length === 1, "should have one default SOP");
  assert(context.sopDefinitions[0].key === "code-delivery", "default SOP key should be code-delivery");

  // 验证文件已创建
  assert(fs.existsSync(path.join(TEST_DIR, ".snail", "init.json")), "init.json should exist");
  assert(fs.existsSync(path.join(TEST_DIR, ".snail", "config", "sop", "code-delivery.yaml")), "code-delivery.yaml should exist");

  // 验证文件内容
  const initJson = JSON.parse(fs.readFileSync(path.join(TEST_DIR, ".snail", "init.json"), "utf8"));
  assert(initJson.name === "Test Workspace", "init.json name should match");

  cleanup();
  console.log("  ✓ testInitializeSnailDirectory passed");
}

// 测试 loadWorkspaceContext
function testLoadWorkspaceContext() {
  cleanup();

  // 目录不存在时抛出异常
  try {
    loadWorkspaceContext(TEST_DIR);
    assert(false, "should throw when .snail does not exist");
  } catch (err) {
    assert(err instanceof Error && err.message.includes(".snail directory not found"), "should throw correct error");
  }

  // 初始化目录后加载
  initializeSnailDirectory(TEST_DIR, { name: "Load Test" });
  const context = loadWorkspaceContext(TEST_DIR);

  assert(context.config.name === "Load Test", "loaded workspace name should match");
  assert(context.sopDefinitions.length === 1, "loaded sops should have one item");
  assert(context.sopDefinitions[0].key === "code-delivery", "loaded sop key should match");

  // 验证 stage_definitions 解析（从平台 config/sop/code-delivery/ 复制，4 阶段）
  const sop = context.sopDefinitions[0];
  assert(sop.stage_definitions.length === 4, "should have four stage definitions");
  assert(sop.stage_definitions[0].key === "design", "first stage should be design");
  assert(sop.stage_definitions[1].key === "development", "second stage should be development");
  assert(sop.stage_definitions[2].key === "review", "third stage should be review");
  assert(sop.stage_definitions[3].key === "merge", "fourth stage should be merge");

  // 验证 roles 内嵌在 stage_definitions 中
  const devStage = sop.stage_definitions[1];
  assert(devStage.roles.length === 1, "development stage should have one role");
  assert(devStage.roles[0].key === "developer", "role key should be developer");
  assert(devStage.roles[0].handbook && devStage.roles[0].handbook.length > 0, "developer should have non-empty handbook");

  cleanup();
  console.log("  ✓ testLoadWorkspaceContext passed");
}

// 测试 initializeSnailDirectory 指定 sopKey
function testInitializeSnailDirectoryWithSopKey() {
  cleanup();

  initializeSnailDirectory(TEST_DIR, { name: "GA Test", sopKey: "general-assistant" });

  // 验证 init.json
  const initJson = JSON.parse(fs.readFileSync(path.join(TEST_DIR, ".snail", "init.json"), "utf8"));
  assert(initJson.name === "GA Test", "init.json name should match");

  // 验证写入了正确的 YAML 文件
  assert(fs.existsSync(path.join(TEST_DIR, ".snail", "config", "sop", "general-assistant.yaml")), "general-assistant.yaml should exist");

  // 验证 handbook 文件被复制
  assert(fs.existsSync(path.join(TEST_DIR, ".snail", "config", "sop", "chat#assistant.handbook.md")), "chat#assistant.handbook.md should exist");

  // 验证 SOP 加载后内容正确
  const context = loadWorkspaceContext(TEST_DIR);
  assert(context.sopDefinitions.length === 1, "should have one sop definition");
  assert(context.sopDefinitions[0].key === "general-assistant", "sop key should be general-assistant");
  assert(context.sopDefinitions[0].stage_definitions.length === 1, "should have one stage definition");
  assert(context.sopDefinitions[0].stage_definitions[0].key === "chat", "stage key should be chat");

  cleanup();
  console.log("  ✓ testInitializeSnailDirectoryWithSopKey passed");
}

// 测试 init.json 缺少 name 字段
function testLoadWorkspaceContextMissingName() {
  cleanup();
  fs.mkdirSync(path.join(TEST_DIR, ".snail"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "init.json"), JSON.stringify({ summary: "no name" }));

  try {
    loadWorkspaceContext(TEST_DIR);
    assert(false, "should throw when name is missing");
  } catch (err) {
    assert(err instanceof Error && err.message.includes("must be a non-empty string"), "should throw correct error for missing name");
  }

  cleanup();
  console.log("  ✓ testLoadWorkspaceContextMissingName passed");
}

// 测试 SOP YAML 缺少 name 字段
function testLoadWorkspaceContextInvalidSop() {
  cleanup();
  fs.mkdirSync(path.join(TEST_DIR, ".snail", "config", "sop"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "init.json"), JSON.stringify({ name: "Test" }));
  fs.writeFileSync(path.join(TEST_DIR, ".snail", "config", "sop", "invalid.yaml"), "description: no name\nstage_definitions: []\n");

  try {
    loadWorkspaceContext(TEST_DIR);
    assert(false, "should throw when sop name is missing");
  } catch (err) {
    assert(err instanceof Error && err.message.includes("must be a non-empty string"), "should throw correct error for missing sop name");
  }

  cleanup();
  console.log("  ✓ testLoadWorkspaceContextInvalidSop passed");
}

// 运行所有测试
console.log("Running snail-loader tests...");
testHasSnailDirectory();
testInitializeSnailDirectory();
testLoadWorkspaceContext();
testInitializeSnailDirectoryWithSopKey();
testLoadWorkspaceContextMissingName();
testLoadWorkspaceContextInvalidSop();
console.log("snail-loader tests passed");
