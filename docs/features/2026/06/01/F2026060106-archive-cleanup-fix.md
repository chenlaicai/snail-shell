---
id: F2026060106
title: archive-cleanup-fix
from_ids: []
tags: []
modules: [workspace-management, persistence]
doc_kind: spec
---

# F2026060106 [workspace-management] 归档清理修复：多 stage 清理与永久保留

## 背景

归档功能（`archiveFeature`/`completeFeature`）本意是清理 feature 关联的本地 worktree、分支等残留资源。实际运行后发现大量残留（66 个 worktree、86 个分支）。

根因分析：
1. `cleanupFeatureRepoContext` 只读取**当前活跃 stage**（`status = 'in_progress'`）的 `output_artifacts`，遗漏了所有已完成 stage 的资源
2. `output_artifacts` 类型为 `Record<string, string>`，`parseJsonRecord` 将所有值强制转为字符串

## 目标

### P1 — 多 stage 资源清理

归档时遍历 feature 下**所有 stage** 的 `output_artifacts`，清理 `worktree_path` 和 `branch_name`。跨 stage 去重。

### P2 — 永久保留产物

每个 `output_artifacts` 的值可以是普通字符串或 `{value, keep}` 对象。`keep: true` 表示永久保留，归档时跳过清理。仅在用户显式要求时使用。

### P3 — output_artifacts 类型修复

将 `Stage.output_artifacts` 从 `Record<string, string>` 拓宽为 `Record<string, unknown>`，修复 `parseJsonRecord` 的 `String(v)` 强制转换。

## 非目标

- 不增加定时清理机制
- 不做数据库迁移

## 设计

### P1 详设

- `cleanupFeatureAllStages(stages: Stage[], options)` 替代原 `cleanupFeatureRepoContext(artifacts, options)`
- `manager.ts` 的 `archiveFeature`/`completeFeature` 改用 `store.listStagesByFeature(featureId)` 获取所有 stage
- 清理逻辑通过路径和分支名格式自然区分：约定 worktree 目录内 → 删 worktree，合法分支名 → 删 branch，其他跳过
- 跨 stage 去重：同一路径/分支只处理一次

### P2 详设

- `output_artifacts` 每个值可以是字符串或 `{value, keep}` 对象
- `keep: true` 表示永久保留，归档时跳过清理
- 通过 `--set worktree_path='{"value":"/path","keep":true}'` 写入
- `parseArtifactEntry` 兼容两种格式：旧格式字符串 `{value: raw}`，新格式对象直接使用

### P3 详设

- `parseJsonRecord` 返回 `Record<string, unknown>`，不再对值做 `String(v)` 转换
- `Stage.output_artifacts` 类型从 `Record<string, string>` 改为 `Record<string, unknown>`
- 下游适配：`builder.ts` 的 `fmt`/`fmtB` 使用 `JSON.stringify` 处理非字符串值；`feature-routes.ts` 的 `parseOutputArtifacts` 不再强制转换；`manager-types.ts` 的 `input_artifacts` 同步拓宽

## 生效路径

- 代码：`src/workspace-workflow/repo-cleanup.ts`、`src/persistence/helpers.ts`、`src/shared/domain-types.ts`
- 提示词：`.meta/prompts/prompts/S-03-研发者手册.md`、`.meta/prompts/prompts/S-04-检视者手册.md`、`.meta/prompts/prompts/B-01-身份与责任契约.md`
- 测试：`tests/workspace/repo-cleanup-test.ts`

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/shared/domain-types.ts` | `output_artifacts` 类型拓宽为 `Record<string, unknown>` |
| `src/persistence/helpers.ts` | `parseJsonRecord` 不再 `String(v)` 强转 |
| `src/workspace-workflow/repo-cleanup.ts` | 重写为 `cleanupFeatureAllStages`，支持 `{value, keep}` 和 flat string |
| `src/workspace-workflow/manager.ts` | `archiveFeature`/`completeFeature` 遍历所有 stage |
| `src/workspace-workflow/index.ts` | 导出更新 |
| `src/workspace-workflow/manager-types.ts` | `input_artifacts` 类型拓宽 |
| `src/prompt-center/builder.ts` | `fmt`/`fmtB` 适配 `Record<string, unknown>` |
| `src/interaction-entry/api/feature-routes.ts` | `parseOutputArtifacts` 不再强制转换 |
| `tests/workspace/repo-cleanup-test.ts` | 多 stage 清理、{value keep} 永久保留、安全拒绝测试 |
| `tests/workspace/stage-cycle-test.ts` | 适配 output_artifacts 类型变化 |

## 验证

### P1

- [x] `cleanupFeatureAllStages` 遍历所有 stage 的 worktree_path/branch_name
- [x] 跨 stage 去重
- [x] 安全拒绝：repo root、protected branch 不会被清理
- [x] 非清理 key（如 pr_url、report_path）不受影响

### P2

- [x] `{value, keep}` 对象中 `keep: true` 跳过清理
- [x] 旧格式 flat string 向后兼容
- [x] 仅用户显式要求时使用

### P3

- [x] `parseJsonRecord` 保留原始类型
- [x] 全量测试通过
- [x] TypeScript 编译无报错

## 关联

- 原归档功能：`archiveFeature`/`completeFeature` in `src/workspace-workflow/manager.ts`
