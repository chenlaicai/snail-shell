---
id: I2026060306
title: feishu-config-direct-credentials
from_ids: [I2026050607]
tags: [config, feishu]
modules: [integrations]
doc_kind: spec
---

# I2026060306 [integrations] 飞书配置改为直接存储凭据

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

当前飞书配置采用间接机制：配置文件中存储环境变量名（`app_id_env`、`app_secret_env`），运行时通过 `process.env[...]` 读取实际值。

Snail Shell 定位是本地运行工具，这种两层间接机制增加了配置复杂度，用户需要同时维护配置文件和环境变量，没有必要。

## 目标

- 简化飞书配置：`app_id` 和 `app_secret` 直接写入配置文件
- 移除环境变量间接层（`app_id_env`、`app_secret_env` 字段）
- 保持 `config/feishu.json` 被 gitignore 的安全性

## 非目标

- 不改变其他飞书配置项（`enabled`、`allowed_chats`、`message_push` 等）
- 不改变飞书 SDK 的初始化方式

## 设计

### 配置字段变更

| 变更 | 旧字段 | 新字段 |
|---|---|---|
| App ID | `app_id_env` (环境变量名) | `app_id` (实际值) |
| App Secret | `app_secret_env` (环境变量名) | `app_secret` (实际值) |

### 代码变更

1. **config/feishu.json.example**：更新字段名和帮助文本
2. **src/interaction-entry/feishu/config.ts**：`FeishuConfig` 类型定义更新
3. **src/persistence/feishu-config-store.ts**：`FeishuConfig` 类型定义更新
4. **src/main.ts**：直接从配置读取 `app_id`/`app_secret`，移除 `process.env` 逻辑
5. **docs/user-manual/feishu-integration-guide.md**：更新配置说明和示例

### 不兼容更新

配置文件字段名变更：`app_id_env` → `app_id`，`app_secret_env` → `app_secret`。用户需要更新已有的 `config/feishu.json`。

## 生效路径

`config/feishu.json` → `loadFeishuConfig()` / `FeishuConfigStore` → `startFeishuChannel()` → `FeishuSdkTransport`

## 设计约束摘要

- 凭据直接存储在配置文件中，配置文件已被 gitignore
- 移除所有环境变量读取逻辑

<!-- [design-time] 章节结束 -->

## 改动范围

- `config/feishu.json.example`
- `src/interaction-entry/feishu/config.ts`
- `src/persistence/feishu-config-store.ts`
- `src/main.ts`
- `docs/user-manual/feishu-integration-guide.md`
- `tests/interaction-entry/feishu-config-test.ts`（新增测试）
- `docs/issues/2026/06/03/I2026060306-feishu-config-direct-credentials.md`（本 Issue 文档）

## 验证

1. 更新 `config/feishu.json` 使用新字段名
2. 启动服务验证飞书连接正常
3. 运行配置加载测试验证类型兼容性

## 关联

- I2026050607: 飞书集成原始 Issue

## 未实现说明（可选）

## 风险与决策记录

## 范围变更记录
