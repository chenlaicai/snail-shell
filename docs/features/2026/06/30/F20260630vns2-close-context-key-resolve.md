---
id: F20260630vns2
title: 修复 closeIssue 资源清理无法解析 stage-prefixed context key
status: in_progress
created_at: 2026-06-30
---

# F20260630vns2 — 修复 closeIssue 资源清理 context key 解析

## 问题

`cleanupResources` 从 `issue.context` 读取 `worktree_path`、`branch_name`、`pr_url`（无前缀），但 Agent 通过 `set_context` MCP 工具写入时使用 `{stage_key}.{artifact_name}` 格式（如 `design.worktree_path`、`development.pr_url`）。

导致 close issue 时资源清理全部 skipped，worktree、分支、PR 均未被清理。

## 修复方案

新增 `resolveContextValue(context, key)` 函数，按以下优先级解析 context value：

1. 精确匹配 `key`（兼容无前缀写入）
2. 匹配任意 `{prefix}.{key}`（兼容 stage-prefixed 写入）
3. 均未命中则返回 undefined

`cleanupResources` 改用 `resolveContextValue` 替代直接 `context[key]` 访问。

## 影响范围

- `src/app/issue-collaboration/resource-cleanup.ts` — 新增 `resolveContextValue`，修改 `cleanupResources`
- `src/app/issue-collaboration/auto-advance.ts` — `getMissingContextFields` 改用 `resolveContextValue`
- `src/app/issue-collaboration/collaboration.ts` — `buildContextBlock` 缺失字段检测改用 `resolveContextValue`
- `tests/resource-cleanup.test.ts` — 新增 resolveContextValue 单测 + prefixed key 清理流程测试
