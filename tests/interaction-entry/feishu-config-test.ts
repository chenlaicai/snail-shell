import fs from "fs";
import path from "path";
import { loadFeishuConfig } from "../../src/interaction-entry/feishu/config";
import { FeishuConfigStore } from "../../src/persistence/feishu-config-store";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const TEST_CONFIG_DIR = path.join(__dirname, "..", "..", "data", "test-config-feishu");
fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });

function cleanup(): void {
  const configPath = path.join(TEST_CONFIG_DIR, "feishu.json");
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
}

/* ── loadFeishuConfig 测试 ────────────────────────────────────────── */

// 测试 1：配置文件不存在时返回默认配置
cleanup();
const defaultConfig = loadFeishuConfig(path.join(TEST_CONFIG_DIR, "feishu.json"));
assert(defaultConfig.enabled === false, "default enabled should be false");
assert(defaultConfig.app_id === "", "default app_id should be empty string");
assert(defaultConfig.app_secret === "", "default app_secret should be empty string");
assert(defaultConfig.allowed_chats.length === 0, "default allowed_chats should be empty");
assert(defaultConfig.message_push.max_text_length === 4000, "default max_text_length should be 4000");

// 测试 2：读取新格式配置（app_id/app_secret）
const newFormatConfig = {
  enabled: true,
  app_id: "cli_test123",
  app_secret: "secret456",
  allowed_chats: [{ chat_id: "oc_xxx", tenant_key: "" }],
  message_push: { max_text_length: 3000 },
};
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "feishu.json"), JSON.stringify(newFormatConfig));
const loadedConfig = loadFeishuConfig(path.join(TEST_CONFIG_DIR, "feishu.json"));
assert(loadedConfig.enabled === true, "loaded enabled should be true");
assert(loadedConfig.app_id === "cli_test123", "loaded app_id should be cli_test123");
assert(loadedConfig.app_secret === "secret456", "loaded app_secret should be secret456");
assert(loadedConfig.allowed_chats.length === 1, "loaded allowed_chats should have 1 item");
assert(loadedConfig.allowed_chats[0].chat_id === "oc_xxx", "loaded chat_id should be oc_xxx");
assert(loadedConfig.message_push.max_text_length === 3000, "loaded max_text_length should be 3000");

// 测试 3：旧格式配置（app_id_env/app_secret_env）会被忽略，使用默认空值
const oldFormatConfig = {
  enabled: true,
  app_id_env: "FEISHU_APP_ID",
  app_secret_env: "FEISHU_APP_SECRET",
  allowed_chats: [],
};
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "feishu.json"), JSON.stringify(oldFormatConfig));
const oldConfig = loadFeishuConfig(path.join(TEST_CONFIG_DIR, "feishu.json"));
assert(oldConfig.enabled === true, "old format enabled should be true");
assert(oldConfig.app_id === "", "old format app_id should fallback to empty string");
assert(oldConfig.app_secret === "", "old format app_secret should fallback to empty string");

// 测试 4：部分配置缺失时使用默认值
const partialConfig = { enabled: true, app_id: "cli_xxx" };
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "feishu.json"), JSON.stringify(partialConfig));
const partialLoaded = loadFeishuConfig(path.join(TEST_CONFIG_DIR, "feishu.json"));
assert(partialLoaded.enabled === true, "partial enabled should be true");
assert(partialLoaded.app_id === "cli_xxx", "partial app_id should be cli_xxx");
assert(partialLoaded.app_secret === "", "partial app_secret should fallback to empty string");
assert(partialLoaded.message_push.max_text_length === 4000, "partial max_text_length should use default");

/* ── FeishuConfigStore 测试 ───────────────────────────────────────── */

// 测试 5：FeishuConfigStore 缓存机制
cleanup();
const store = new FeishuConfigStore(TEST_CONFIG_DIR);
const storeDefault = store.getConfig();
assert(storeDefault.enabled === false, "store default enabled should be false");
assert(storeDefault.app_id === "", "store default app_id should be empty");

// 写入配置后，缓存应该返回旧值（因为已缓存）
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "feishu.json"), JSON.stringify({ enabled: true, app_id: "cached" }));
const cachedConfig = store.getConfig();
assert(cachedConfig.enabled === false, "cached config should still be default");

// 创建新 store 实例应该读取新配置
const store2 = new FeishuConfigStore(TEST_CONFIG_DIR);
const freshConfig = store2.getConfig();
assert(freshConfig.enabled === true, "fresh store should read new config");
assert(freshConfig.app_id === "cached", "fresh store should read new app_id");

// 测试 6：无效的 allowed_chats 条目被过滤
const invalidChatsConfig = {
  enabled: true,
  app_id: "cli_xxx",
  app_secret: "secret",
  allowed_chats: [
    { chat_id: "oc_valid" },
    { chat_id: "" },  // 空 chat_id 应该被过滤
    { chat_id: "  " },  // 空白 chat_id 应该被过滤
    null,  // null 条目应该被过滤
    "invalid",  // 非对象条目应该被过滤
  ],
};
fs.writeFileSync(path.join(TEST_CONFIG_DIR, "feishu.json"), JSON.stringify(invalidChatsConfig));
const invalidLoaded = loadFeishuConfig(path.join(TEST_CONFIG_DIR, "feishu.json"));
assert(invalidLoaded.allowed_chats.length === 1, "should filter invalid chat entries");
assert(invalidLoaded.allowed_chats[0].chat_id === "oc_valid", "should keep valid chat entry");

// 清理
cleanup();

console.log("All feishu config tests passed.");
