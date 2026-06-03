---
id: I2026051902
title: 脚本清理
from_ids: []
tags: [refactor]
modules: [project_management]
---
# I2026051902 脚本清理

## 背景

`regulation-expand` 原本服务旧 prompt 展开链路。当前 Prompt Center 页面已经通过 `/api/meta/prompts` 和 `/api/meta/frames` 直接读取 `prompt-center` 注册表，`regulation-expand` 只剩独立 CLI 包装，名称和实际行为不再匹配。

角色模型重构后，代码中仍残留 `SnailRegistry`、`SnailDefinition`、`AgentSnailDefinition` 和 `src/snails` 兼容出口。这些兼容层会让后续维护者误判当前领域模型，继续把 role 与 snail runtime 概念混在一起。

## 目标

1. 删除不再被 Prompt Center 页面或运行时代码依赖的 `regulation-expand` CLI。
2. 删除停用的 `SnailRegistry`、`SnailDefinition`、`AgentSnailDefinition` 兼容别名。
3. 删除 `src/snails` 旧命名入口，将代码层角色注册表统一到 `src/roles`。
4. 保持 DB、消息协议和 API 中已有 `*_snail` 持久字段不变，避免无关数据迁移。

## 非目标

1. 不改写已合入 feature 文档中的历史记录。
2. 不迁移数据库列名、消息事件字段或外部协议字段中的 `snail` 命名。
3. 不处理知识状态、设计决策状态中的 `deprecated` 业务枚举。

## 设计

Prompt Center 页面读取路径保持为服务端 API：`listPrompts()` / `listFrames()` 读取 `.meta/prompts`，`src/web/app.js` 调用 `/meta/prompts` 和 `/meta/frames` 后交给 `prompt-library.js` 渲染。`regulation-expand` 不在这条链路中，因此直接删除脚本、CLI 源码和 dist 复制逻辑。

角色注册表的实现从 `src/snails/registry.ts` 移入 `src/roles/registry.ts`。内部模块和测试统一从 `src/roles` 引用 `RoleRegistry` 和 `RoleDefinition`，不再通过 `src/snails` 兼容出口。

`RoleRegistry` 删除按全局 role name 搜索的 `get()`、`getByName()`、`has()`。会话角色解析只在当前会话 stage definition 内通过 `getByStageDefinitionName()` 查找，避免跨项目或跨 stage 的同名 role 被错误命中。

## 生效路径

1. `.meta/scripts/regulation-expand` 被删除。
2. `src/bin/regulation-expand.ts` 被删除。
3. `scripts/build-dist.ts` 不再复制 `regulation-expand` 到 dist。
4. `src/roles/registry.ts` 成为 `RoleRegistry` 的唯一实现入口。
5. `src/snails/` 旧兼容目录被删除。

## 改动范围

1. 删除 `regulation-expand` CLI 和构建复制逻辑。
2. 清理 role/snail 兼容别名、旧方法和内部引用。
3. 更新相关测试 import 和类型名。

## 验证

1. `npx tsc --noEmit` 通过。
2. `npm run lint` 通过，保留 22 个既有模块边界 warning，无 error。
3. `npm test` 通过，37 个 compiled test files 全部通过。

## 风险与决策记录

1. 决策：不保留 `regulation-expand` 兼容入口。原因是当前用户明确不考虑外部人工使用，内部页面/API 不依赖该脚本。
2. 决策：不再提供 `src/snails` 兼容出口。原因是角色注册表已经是当前正确模型，保留旧命名只会继续污染语义边界。
3. 决策：不迁移持久字段中的 `snail` 命名。原因是这些字段属于 DB 和消息协议边界，迁移会扩大到数据兼容与协议变更，不属于本次代码残留清理。

## 范围变更记录

暂无。
