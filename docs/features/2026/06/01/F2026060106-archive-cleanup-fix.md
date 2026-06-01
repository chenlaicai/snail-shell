---
id: F2026060106
title: archive-cleanup-fix
from_ids: []
tags: []
modules: [workspace-management, persistence]
doc_kind: spec
---

# F2026060106 [workspace-management] 归档清理修复：多 stage 资源追踪与清理

## 背景

归档功能（`archiveFeature`/`completeFeature`）本意是清理 feature 关联的本地 worktree、分支等残留资源。实际运行后发现大量残留（66 个 worktree、86 个分支）。

根因分析：
1. `cleanupFeatureRepoContext` 只读取**当前活跃 stage**（`status = 'in_progress'`）的 `output_artifacts`，遗漏了所有已完成 stage 的资源
2. 每个 stage 有多个角色（研发者、检视者）可能各自创建 worktree/branch，但 `output_artifacts` 是扁平 key-value，无法追踪多角色资源
3. `output_artifacts` 类型为 `Record<string, string>`，`parseJsonRecord` 将所有值强制转为字符串，导致数组值被破坏为 `"[object Object]"`

## 目标

### P1 — 多 stage 资源收集

归档时遍历 feature 下**所有 stage** 的 `output_artifacts`，收集并清理全部资源。

### P2 — 多角色资源追踪

引入 `resources` 数组格式，每个角色创建资源时通过 `--add-resource` 追加记录，支持 `by` 字段标识来源角色。

### P3 — output_artifacts 类型修复

将 `Stage.output_artifacts` 从 `Record<string, string>` 拓宽为 `Record<string, unknown>`，修复 `parseJsonRecord` 的 `String(v)` 强制转换，使数组值能正确持久化。

## 非目标

- 不增加定时清理机制
- 不做数据库迁移（代码仓在任何时刻都是最终完美状态）

## 设计

### P1 详设

- `cleanupFeatureAllStages(stages: Stage[], options)` 替代原 `cleanupFeatureRepoContext(artifacts, options)`
- `manager.ts` 的 `archiveFeature`/`completeFeature` 改用 `store.listStagesByFeature(featureId)` 获取所有 stage
- `collectResources(artifacts)` 同时读取 `resources` 数组（新格式）和 `worktree_path`/`branch_name` 扁平 key（旧格式），去重后统一清理

### P2 详设

- `resources` 数组格式：`[{ type: "worktree"|"branch", value: string, by?: string }]`
- `record-feature-repo-context.js` 新增 `--add-resource` 参数，解析 JSON 对象后追加到 `entries.resources`
- 永久保留的产物（如报告）不记入 resources，直接 `--set` 写入 output_artifacts 即可
- `db-bridge.js` merge 逻辑改为数组 concat（`Array.isArray` 检测，concat 而非覆盖）
- 提示词（S-03、S-04、B-01 等）增加 HARD 规则：任何角色创建 worktree/branch 必须 `--add-resource` 记录

### P3 详设

- `parseJsonRecord` 返回 `Record<string, unknown>`，不再对值做 `String(v)` 转换
- `Stage.output_artifacts` 类型从 `Record<string, string>` 改为 `Record<string, unknown>`
- 下游适配：`builder.ts` 的 `fmt`/`fmtB` 使用 `JSON.stringify` 处理非字符串值；`feature-routes.ts` 的 `parseOutputArtifacts` 不再强制转换；`manager-types.ts` 的 `input_artifacts` 同步拓宽

## 生效路径

- 代码：`src/workspace-workflow/repo-cleanup.ts`、`src/persistence/helpers.ts`、`src/shared/domain-types.ts`
- 脚本：`.meta/scripts/db-bridge.js`、`.meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js`
- 提示词：`.meta/prompts/prompts/S-03-研发者手册.md`、`.meta/prompts/prompts/S-04-检视者手册.md`、`.meta/prompts/prompts/B-01-身份与责任契约.md`
- 测试：`tests/workspace/repo-cleanup-test.ts`

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/shared/domain-types.ts` | `output_artifacts` 类型拓宽为 `Record<string, unknown>` |
| `src/persistence/helpers.ts` | `parseJsonRecord` 不再 `String(v)` 强转 |
| `src/workspace-workflow/repo-cleanup.ts` | 新增 `cleanupFeatureAllStages`、`collectResources`、`ResourceEntry` |
| `src/workspace-workflow/manager.ts` | `archiveFeature`/`completeFeature` 遍历所有 stage |
| `src/workspace-workflow/index.ts` | 导出更新 |
| `src/workspace-workflow/manager-types.ts` | `input_artifacts` 类型拓宽 |
| `src/prompt-center/builder.ts` | `fmt`/`fmtB` 适配 `Record<string, unknown>` |
| `src/interaction-entry/api/feature-routes.ts` | `parseOutputArtifacts` 不再强制转换 |
| `.meta/scripts/db-bridge.js` | merge 逻辑支持数组 concat |
| `.meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js` | 新增 `--add-resource` 参数解析 |
| `.meta/prompts/prompts/S-03-研发者手册.md` | HARD 规则：`--add-resource` 记录资源 |
| `.meta/prompts/prompts/S-04-检视者手册.md` | HARD 规则：`--add-resource` 记录资源 |
| `.meta/prompts/prompts/B-01-身份与责任契约.md` | HARD 规则：`--add-resource` 记录资源 |
| `.meta/skills/developer-handbook/SKILL.md` | HARD 规则：`--add-resource` 记录资源 |
| `.meta/skills/reviewer-handbook/SKILL.md` | HARD 规则：`--add-resource` 记录资源 |
| `.meta/skills/record-feature-repo-context/SKILL.md` | `--add-resource` 用法说明 |
| `tests/workspace/repo-cleanup-test.ts` | 多 stage 清理、resources 数组、`--add-resource` 测试 |
| `tests/workspace/stage-cycle-test.ts` | 适配 output_artifacts 类型变化 |

## 验证

### P1

- [x] `cleanupFeatureAllStages` 收集所有 stage 的 resources
- [x] 去重：同一 worktree/branch 不重复清理
- [x] 安全拒绝：repo root、protected branch 不会被清理

### P2

- [x] `--add-resource` 正确解析 JSON 并追加到 resources 数组
- [x] 多次 `--add-resource` 调用累积而非覆盖
- [x] `resources` 数组值在 DB 读写后保持完整（非 `"[object Object]"`）

### P3

- [x] `parseJsonRecord` 保留原始类型
- [x] 全量测试通过（45 个测试文件）
- [x] TypeScript 编译无报错

## 关联

- 原归档功能：`archiveFeature`/`completeFeature` in `src/workspace-workflow/manager.ts`
