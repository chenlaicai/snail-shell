---
id: F2026052204
title: 兼容残留清理与代码仓完美状态规则
from_ids: []
tags: [refactor]
modules: [project_management]
---
# F2026052204 兼容残留清理与代码仓完美状态规则

## 背景

代码仓中残留了多处兼容性迁移处理、废弃 API 和标记 `@deprecated` 的字段。这些残留违反了"代码仓在任何时刻都是最终完美状态"的核心原则。同时，系统提示词中虽然已有部分相关规则，但表述不够明确和强调。

具体发现：
- `src/persistence/migrations.ts`：包含 `ALTER TABLE ADD COLUMN` 自动迁移逻辑，且该列已在 schema 的 CREATE TABLE 中定义，属死代码
- `src/persistence/store.ts`：import 并调用 migration，且 HARD RULE 注释与代码行为自相矛盾
- `src/interaction-entry/api/feature-routes.ts`：保留已废弃的 `repo-context` 端点（返回 410）
- `src/project-workflow/manager.ts`：保留 `updateFeatureRepoContext()` 方法（仅抛出 deprecated 错误）
- `src/prompt-center/registry.ts`：保留 `@deprecated snails` 字段

## 目标

1. 清除所有代码仓中的兼容性迁移残留、废弃 API、废弃字段
2. 强化和明确系统提示词中的核心规则：代码仓完美状态、不允许自动迁移、不兼容变更只记录在 feature 文档

## 非目标

- 不修改业务领域模型中的 `deprecated` 状态枚举（knowledge/design-decision 的 lifecycle status）
- 不修改 `persistence/types.ts` 的 re-export barrel 架构

## 设计

### 代码清除

直接删除废弃代码，不做过渡、不做兼容层：

| 文件 | 操作 |
|------|------|
| `src/persistence/migrations.ts` | 删除整个文件 |
| `src/persistence/store.ts` | 移除 import（L21）、调用（L129）、精简 HARD RULE 注释（L132-144） |
| `src/interaction-entry/api/feature-routes.ts` | 移除废弃的 `repo-context` 端点（L66-68） |
| `src/project-workflow/manager.ts` | 移除 `updateFeatureRepoContext()` 方法（L177-179） |
| `src/prompt-center/registry.ts` | 移除 `@deprecated snails` 字段（L13-14） |

### 提示词优化

在 `S-03 研发者手册.md` 的实现阶段增加硬性规则：

1. 数据库启动 bootstrap 只允许 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
2. 严禁任何自动迁移逻辑（ALTER TABLE、数据迁移脚本、migration 文件）
3. 不兼容变更只在 feature 文档 `## 不兼容更新` 段落中说明，代码仓不构建兼容性桥接

对 B-01 中已有的"不引入需要后续清理的残留状态"做配套表述。

## 生效路径

- `.meta/prompts/prompts/S-03-研发者手册.md`：实现阶段硬性规则
- `.meta/skills/developer-handbook/SKILL.md`：实现阶段操作细则
- `src/persistence/store.ts`：HARD RULE 注释

## 改动范围

- 删除：`src/persistence/migrations.ts`
- 修改：`src/persistence/store.ts`
- 修改：`src/interaction-entry/api/feature-routes.ts`
- 修改：`src/project-workflow/manager.ts`
- 修改：`src/prompt-center/registry.ts`
- 修改：`.meta/prompts/prompts/S-03-研发者手册.md`
- 修改：`.meta/skills/developer-handbook/SKILL.md`

## 验证

- TypeScript 编译通过（`npx tsc --noEmit`）
- 现有测试通过（`npm test`）
- 人工确认：无残留的 migration/ALTER TABLE/废弃 API/废弃字段

## 风险与决策记录

- `task_anchor` 列已在 `schema.ts` 的 CREATE TABLE 中定义（L51），现有数据库已通过之前的 migration 添加了该列，删除 migration 后不再有影响
- `repo-context` 前端已改用 `PATCH /stages/:stageId`（repo-context-view.js L32 注释确认），删除 API 端点无影响
- `updateFeatureRepoContext()` 无任何调用方，安全删除
- `PromptWhen.snails` 字段无任何使用方，安全删除

## 交付信息

- 分支: `feature/F2026052203-compat-cleanup`
- PR: https://github.com/chenlaicai/snail-shell/pull/245

## 范围变更记录

（无）

## 不兼容更新

- 删除 `PATCH /features/:featureId/repo-context` API 端点
- 删除 `updateFeatureRepoContext()` 方法
- 删除 `PromptWhen.snails` 字段
